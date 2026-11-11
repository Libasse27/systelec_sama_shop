import "server-only";
import type { Prisma, PrismaClient } from "@/generated/prisma/client";
import { businessYear } from "@/lib/dates";
import { formatFcfa } from "@/lib/money";
import { isMobilePaymentMethod, paymentMethodPhrase, transactionReferenceKey, type PaymentMethod } from "@/lib/payment-methods";
import { recordAudit } from "@/server/audit/audit";
import { assertPermission, type Actor } from "@/server/authz/service";
import { isUniqueViolation } from "@/server/db/errors";
import { AppError } from "@/server/errors";
import { frozenCompanyHeader } from "@/server/modules/payments/queries";
import { nextBusinessNumber } from "@/server/modules/sequences/service";
import { getSetting } from "@/server/modules/settings/service";
import { dispatchNotifications } from "@/server/notifications/queue";
import { parseInput } from "@/server/validation";
import { amountRefusal } from "./balance";
import { recordPaymentSchema, voidPaymentSchema } from "./schemas";
import { lockTarget, targetLink, targetOf, type PaymentTarget } from "./targets";

const sameTarget = (payment: { orderId: string | null; interventionId: string | null }, target: PaymentTarget) =>
  target.kind === "order" ? payment.orderId === target.id : payment.interventionId === target.id;

/**
 * Décision 5 (phase 10) : sans payments.record, le livreur interne encaisse le solde de la commande
 * qu'il est en train de livrer (livraison « en cours », assignée à son compte), et rien d'autre.
 */
async function isOwnDeliveryInTransit(client: Prisma.TransactionClient | PrismaClient, actor: Actor, target: PaymentTarget): Promise<boolean> {
  if (target.kind !== "order" || !actor.permissions.has("deliveries.update_own")) return false;
  const delivery = await client.delivery.findUnique({ where: { orderId: target.id }, select: { status: true, courier: { select: { userId: true, isActive: true } } } });
  return delivery?.status === "IN_TRANSIT" && delivery.courier.isActive && delivery.courier.userId === actor.id;
}

const DUPLICATE_REFERENCE_MESSAGE = "Cette référence de transaction a déjà été enregistrée pour un autre encaissement.";

/**
 * Une référence de transfert ne justifie qu'un encaissement en cours de validité. La comparaison porte sur la
 * forme canonique (sans point, tiret ni tiret bas : TX-123, TX.123 et TX123 sont le même transfert), la référence
 * restant stockée telle que saisie. Verrou consultatif de la transaction (méthode + clé) : deux saisies
 * simultanées, sur des commandes différentes donc sous des verrous différents, se suivent. Un encaissement annulé
 * libère sa référence (erreur de montant corrigée par annulation puis nouvelle saisie), d'où l'absence d'index
 * unique partiel.
 */
async function assertReferenceUnused(tx: Prisma.TransactionClient, method: PaymentMethod, transactionReference: string): Promise<void> {
  const key = transactionReferenceKey(transactionReference);
  await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${`payment-reference:${method}:${key}`}))`;
  const used = await tx.$queryRaw<{ id: string }[]>`
    SELECT "id" FROM "payments"
    WHERE "method" = ${method}::"PaymentMethod"
      AND "amount" > 0
      AND regexp_replace("transactionReference", '[._-]', '', 'g') = ${key}
      AND NOT EXISTS (SELECT 1 FROM "payments" r WHERE r."reversesPaymentId" = "payments"."id")
    LIMIT 1`;
  // Message volontairement muet sur la commande ou le client concernés.
  if (used.length > 0) throw new AppError("CONFLICT", DUPLICATE_REFERENCE_MESSAGE);
}

/** Contrôle AVANT la transaction (refus journalisé) ; revérifié sous verrou pour un livreur. */
async function authorizeRecord(client: PrismaClient, actor: Actor, target: PaymentTarget): Promise<void> {
  if (actor.permissions.has("payments.record") || (await isOwnDeliveryInTransit(client, actor, target))) return;
  await assertPermission(client, actor, "payments.record");
}

export interface RecordedPayment {
  id: string;
  receiptNumber: string;
  /** Vrai si l'encaissement existait déjà (double envoi du même formulaire). */
  replayed: boolean;
}

/**
 * Enregistre un encaissement, avec son moyen de paiement (permission payments.record, ou livreur interne sur sa
 * livraison en cours) sur une commande ou une intervention : montant contrôlé sous verrou (jamais au-delà du solde ; solde complet si le
 * partiel est désactivé), reçu numéroté, statut de paiement recalculé, audité et notifié.
 */
export async function recordPayment(client: PrismaClient, actor: Actor, target: PaymentTarget, input: unknown): Promise<RecordedPayment> {
  await authorizeRecord(client, actor, target);
  const { amount, method, transactionReference, note, idempotencyKey } = parseInput(recordPaymentSchema, input, "Encaissement");
  const { partialPaymentEnabled } = await getSetting("commerce", client);

  let recorded: RecordedPayment;
  try {
    recorded = await client.$transaction(async (tx) => {
      const locked = await lockTarget(tx, target);
      // Livreur : revérifié sous le verrou de la commande (livraison réassignée ou terminée entre-temps).
      if (!actor.permissions.has("payments.record") && !(await isOwnDeliveryInTransit(tx, actor, target))) {
        throw new AppError("FORBIDDEN", "Cette livraison n'est plus en cours avec vous.");
      }
      const existing = await tx.payment.findUnique({
        where: { idempotencyKey },
        select: { id: true, receiptNumber: true, orderId: true, interventionId: true, recordedById: true, amount: true, method: true, transactionReference: true },
      });
      if (existing) {
        if (!sameTarget(existing, target) || existing.recordedById !== actor.id || existing.amount !== amount || existing.method !== method || existing.transactionReference !== transactionReference) {
          throw new AppError("CONFLICT", "Cet encaissement a déjà été envoyé.");
        }
        return { id: existing.id, receiptNumber: existing.receiptNumber, replayed: true };
      }
      if (locked.notPayable) throw new AppError("CONFLICT", locked.notPayable);
      if (transactionReference && isMobilePaymentMethod(method)) await assertReferenceUnused(tx, method, transactionReference);
      const refusal = amountRefusal({ total: locked.total, amountPaid: locked.amountPaid, amount, partialPaymentEnabled });
      if (refusal) throw new AppError("CONFLICT", refusal);

      const receiptNumber = await nextBusinessNumber(tx, "receipt", businessYear());
      const balanceAfter = locked.total - locked.amountPaid - amount;
      const payment = await tx.payment.create({
        data: { receiptNumber, ...targetLink(target), amount, method, transactionReference, balanceAfter, recordedById: actor.id, idempotencyKey, note, company: await frozenCompanyHeader(tx) },
        select: { id: true },
      });
      const paymentStatus = await locked.apply(amount, actor.id, `Encaissement ${receiptNumber} : ${formatFcfa(amount)} ${paymentMethodPhrase(method)}`);
      await locked.notify({ amount, balance: balanceAfter, receiptNumber, method });
      await recordAudit(tx, {
        actorId: actor.id,
        action: "payment.record",
        entityType: "Payment",
        entityId: payment.id,
        before: { ...targetLink(target), amountPaid: locked.amountPaid, paymentStatus: locked.paymentStatus },
        after: { ...targetLink(target), receiptNumber, amount, method, transactionReference, amountPaid: locked.amountPaid + amount, paymentStatus },
      });
      return { id: payment.id, receiptNumber, replayed: false };
    });
  } catch (error) {
    // Clé déjà utilisée sur un autre document, en parallèle : refus explicite plutôt qu'erreur technique.
    if (isUniqueViolation(error)) throw new AppError("CONFLICT", "Cet encaissement a déjà été envoyé.");
    throw error;
  }
  // Après validation ; ne lève jamais : un incident d'envoi ne fait pas paraître l'encaissement échoué.
  if (!recorded.replayed) await dispatchNotifications(client, targetLink(target));
  return recorded;
}

export const recordOrderPayment = (client: PrismaClient, actor: Actor, orderId: string, input: unknown) =>
  recordPayment(client, actor, { kind: "order", id: orderId }, input);

export const recordInterventionPayment = (client: PrismaClient, actor: Actor, interventionId: string, input: unknown) =>
  recordPayment(client, actor, { kind: "intervention", id: interventionId }, input);

/**
 * Annule un encaissement par une CONTRE-ÉCRITURE (permission payments.correct) : une nouvelle
 * ligne de montant opposé, liée à l'originale, avec motif et reçu propre. L'originale n'est
 * jamais modifiée ; un encaissement ne s'annule qu'une fois et une contre-écriture jamais.
 */
export async function voidPayment(client: PrismaClient, actor: Actor, paymentId: string, input: unknown): Promise<{ receiptNumber: string }> {
  await assertPermission(client, actor, "payments.correct");
  const { reason } = parseInput(voidPaymentSchema, input, "Annulation d'encaissement");
  const found = await client.payment.findUnique({ where: { id: paymentId }, select: { orderId: true, interventionId: true } });
  if (!found) throw new AppError("NOT_FOUND", "Encaissement introuvable.");
  const target = targetOf(found);

  try {
    return await client.$transaction(async (tx) => {
      const locked = await lockTarget(tx, target);
      // Relu sous le verrou de la cible : une annulation concurrente est vue ici.
      const original = await tx.payment.findUniqueOrThrow({
        where: { id: paymentId },
        select: { receiptNumber: true, amount: true, method: true, transactionReference: true, reversesPaymentId: true, reversedBy: { select: { id: true } } },
      });
      if (original.reversesPaymentId) throw new AppError("CONFLICT", "Une contre-écriture ne s'annule pas.");
      if (original.reversedBy) throw new AppError("CONFLICT", "Cet encaissement est déjà annulé.");
      if (locked.notVoidable) throw new AppError("CONFLICT", locked.notVoidable);

      const receiptNumber = await nextBusinessNumber(tx, "receipt", businessYear());
      const reversal = await tx.payment.create({
        data: {
          receiptNumber,
          ...targetLink(target),
          amount: -original.amount,
          // Même moyen que l'original : l'annulation doit se déduire du bon total par moyen.
          method: original.method,
          // Aucun nouveau transfert : la référence de l'original, exigée par la base pour un moyen mobile.
          transactionReference: original.transactionReference,
          balanceAfter: locked.total - locked.amountPaid + original.amount,
          recordedById: actor.id,
          reversesPaymentId: paymentId,
          reason,
          company: await frozenCompanyHeader(tx),
        },
        select: { id: true },
      });
      const paymentStatus = await locked.apply(-original.amount, actor.id, `Annulation du reçu ${original.receiptNumber} (${receiptNumber}) : ${reason}`);
      await recordAudit(tx, {
        actorId: actor.id,
        action: "payment.void",
        entityType: "Payment",
        entityId: paymentId,
        before: { amountPaid: locked.amountPaid, paymentStatus: locked.paymentStatus },
        after: { reversalId: reversal.id, receiptNumber, reason, amountPaid: locked.amountPaid - original.amount, paymentStatus },
      });
      return { receiptNumber };
    });
  } catch (error) {
    if (isUniqueViolation(error)) throw new AppError("CONFLICT", "Cet encaissement est déjà annulé.");
    throw error;
  }
}
