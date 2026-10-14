import "server-only";
import { Prisma, type OrderStatus, type PaymentStatus, type PrismaClient } from "@/generated/prisma/client";
import { businessYear } from "@/lib/dates";
import { formatFcfa } from "@/lib/money";
import { recordAudit } from "@/server/audit/audit";
import { assertPermission, type Actor } from "@/server/authz/service";
import { AppError } from "@/server/errors";
import { lockOrderRow } from "@/server/modules/orders/lock";
import type { Contact } from "@/server/modules/orders/schemas";
import { nextBusinessNumber } from "@/server/modules/sequences/service";
import { getSetting } from "@/server/modules/settings/service";
import { dispatchOrderNotifications, queueOrderNotifications } from "@/server/notifications/order-notifications";
import { parseInput } from "@/server/validation";
import { logger } from "@/server/logger";
import { amountRefusal, PAYABLE_ORDER_STATUSES, paymentStatusFor } from "./balance";
import { recordPaymentSchema, voidPaymentSchema } from "./schemas";

type Tx = Prisma.TransactionClient;

interface LockedOrder {
  id: string;
  number: string;
  status: OrderStatus;
  paymentStatus: PaymentStatus;
  total: number;
  amountPaid: number;
  fulfillmentMethod: "DELIVERY" | "PICKUP";
  contact: Contact;
}

/**
 * Verrouille la commande (FOR UPDATE) : encaissements, contre-écritures et changements de
 * statut d'une même commande s'exécutent l'un après l'autre, sur un solde toujours exact.
 */
async function lockOrder(tx: Tx, orderId: string): Promise<LockedOrder> {
  await lockOrderRow(tx, orderId);
  const order = await tx.order.findUniqueOrThrow({
    where: { id: orderId },
    select: { id: true, number: true, status: true, paymentStatus: true, total: true, amountPaid: true, fulfillmentMethod: true, contact: true },
  });
  return { ...order, contact: order.contact as unknown as Contact };
}

/** Applique une écriture au solde de la commande et l'historise (champ PAYMENT). */
async function applyToOrder(tx: Tx, order: LockedOrder, amount: number, actorId: string, comment: string): Promise<PaymentStatus> {
  const amountPaid = order.amountPaid + amount;
  const paymentStatus = paymentStatusFor(order.total, amountPaid);
  await tx.order.update({ where: { id: order.id }, data: { amountPaid, paymentStatus } });
  await tx.orderStatusHistory.create({
    data: { orderId: order.id, field: "PAYMENT", from: order.paymentStatus, to: paymentStatus, actorId, comment },
  });
  return paymentStatus;
}

const NOT_PAYABLE: Partial<Record<OrderStatus, string>> = {
  PENDING_CONFIRMATION: "Confirmez la commande avant d'encaisser.",
  CANCELLED: "Une commande annulée ne s'encaisse pas.",
  CLOSED: "Cette commande est déjà remise au client et soldée.",
};

/** Notification au client : montant reçu, reste à payer, numéro du reçu. */
function notifyPayment(tx: Tx, order: LockedOrder, payment: { amount: number; balance: number; receiptNumber: string }): Promise<void> {
  return queueOrderNotifications(
    tx,
    order.id,
    "order.payment",
    { number: order.number, customerName: order.contact.name, total: order.total, fulfillment: order.fulfillmentMethod, payment },
    { email: order.contact.email, phone: order.contact.phone },
  );
}

const isUniqueViolation = (error: unknown) => error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002";

export interface RecordedPayment {
  id: string;
  receiptNumber: string;
  /** Vrai si l'encaissement existait déjà (double envoi du même formulaire). */
  replayed: boolean;
}

/**
 * Enregistre un encaissement en espèces (permission payments.record) :
 * montant contrôlé sous verrou (jamais au-delà du solde ; solde complet si le partiel est
 * désactivé), reçu numéroté, statut de paiement recalculé, historisé, audité et notifié.
 */
export async function recordOrderPayment(client: PrismaClient, actor: Actor, orderId: string, input: unknown): Promise<RecordedPayment> {
  await assertPermission(client, actor, "payments.record");
  const { amount, note, idempotencyKey } = parseInput(recordPaymentSchema, input, "Encaissement");
  const { partialPaymentEnabled } = await getSetting("commerce", client);

  let recorded: RecordedPayment;
  try {
    recorded = await client.$transaction(async (tx) => {
      const order = await lockOrder(tx, orderId);
      const existing = await tx.payment.findUnique({ where: { idempotencyKey }, select: { id: true, receiptNumber: true, orderId: true, recordedById: true, amount: true } });
      if (existing) {
        if (existing.orderId !== orderId || existing.recordedById !== actor.id || existing.amount !== amount) throw new AppError("CONFLICT", "Cet encaissement a déjà été envoyé.");
        return { id: existing.id, receiptNumber: existing.receiptNumber, replayed: true };
      }
      if (!PAYABLE_ORDER_STATUSES.includes(order.status)) throw new AppError("CONFLICT", NOT_PAYABLE[order.status] ?? "Cette commande ne s'encaisse pas.");
      const refusal = amountRefusal({ total: order.total, amountPaid: order.amountPaid, amount, partialPaymentEnabled });
      if (refusal) throw new AppError("CONFLICT", refusal);

      const receiptNumber = await nextBusinessNumber(tx, "receipt", businessYear());
      const balanceAfter = order.total - order.amountPaid - amount;
      const payment = await tx.payment.create({
        data: { receiptNumber, orderId, amount, balanceAfter, recordedById: actor.id, idempotencyKey, note },
        select: { id: true },
      });
      const paymentStatus = await applyToOrder(tx, order, amount, actor.id, `Encaissement ${receiptNumber} : ${formatFcfa(amount)} en espèces`);
      await notifyPayment(tx, order, { amount, balance: balanceAfter, receiptNumber });
      await recordAudit(tx, {
        actorId: actor.id,
        action: "payment.record",
        entityType: "Payment",
        entityId: payment.id,
        before: { orderId, amountPaid: order.amountPaid, paymentStatus: order.paymentStatus },
        after: { orderId, receiptNumber, amount, amountPaid: order.amountPaid + amount, paymentStatus },
      });
      return { id: payment.id, receiptNumber, replayed: false };
    });
  } catch (error) {
    // Clé déjà utilisée sur une autre commande, en parallèle : refus explicite plutôt qu'erreur technique.
    if (isUniqueViolation(error)) throw new AppError("CONFLICT", "Cet encaissement a déjà été envoyé.");
    throw error;
  }
  if (!recorded.replayed) {
    // L'encaissement est validé : un incident d'envoi ne doit pas le faire paraître échoué.
    await dispatchOrderNotifications(client, orderId).catch((error: unknown) =>
      logger.error("Notification d'encaissement non envoyée", { orderId, error: error instanceof Error ? error.message : "inconnue" }),
    );
  }
  return recorded;
}

/**
 * Annule un encaissement par une CONTRE-ÉCRITURE (permission payments.correct) : une nouvelle
 * ligne de montant opposé, liée à l'originale, avec motif et reçu propre. L'originale n'est
 * jamais modifiée ; un encaissement ne s'annule qu'une fois et une contre-écriture jamais.
 */
export async function voidPayment(client: PrismaClient, actor: Actor, paymentId: string, input: unknown): Promise<{ receiptNumber: string }> {
  await assertPermission(client, actor, "payments.correct");
  const { reason } = parseInput(voidPaymentSchema, input, "Annulation d'encaissement");
  const target = await client.payment.findUnique({ where: { id: paymentId }, select: { orderId: true } });
  if (!target) throw new AppError("NOT_FOUND", "Encaissement introuvable.");

  try {
    return await client.$transaction(async (tx) => {
      const order = await lockOrder(tx, target.orderId);
      // Relu sous le verrou de la commande : une annulation concurrente est vue ici.
      const original = await tx.payment.findUniqueOrThrow({
        where: { id: paymentId },
        select: { receiptNumber: true, amount: true, reversesPaymentId: true, reversedBy: { select: { id: true } } },
      });
      if (original.reversesPaymentId) throw new AppError("CONFLICT", "Une contre-écriture ne s'annule pas.");
      if (original.reversedBy) throw new AppError("CONFLICT", "Cet encaissement est déjà annulé.");
      // Commande remise : stock sorti et commande soldée ; la correction passera par un retour (phase 9).
      if (order.status === "CLOSED") throw new AppError("CONFLICT", "Commande déjà remise au client : un encaissement ne s'y annule plus.");

      const receiptNumber = await nextBusinessNumber(tx, "receipt", businessYear());
      const reversal = await tx.payment.create({
        data: {
          receiptNumber,
          orderId: order.id,
          amount: -original.amount,
          balanceAfter: order.total - order.amountPaid + original.amount,
          recordedById: actor.id,
          reversesPaymentId: paymentId,
          reason,
        },
        select: { id: true },
      });
      const paymentStatus = await applyToOrder(tx, order, -original.amount, actor.id, `Annulation du reçu ${original.receiptNumber} (${receiptNumber}) : ${reason}`);
      await recordAudit(tx, {
        actorId: actor.id,
        action: "payment.void",
        entityType: "Payment",
        entityId: paymentId,
        before: { amountPaid: order.amountPaid, paymentStatus: order.paymentStatus },
        after: { reversalId: reversal.id, receiptNumber, reason, amountPaid: order.amountPaid - original.amount, paymentStatus },
      });
      return { receiptNumber };
    });
  } catch (error) {
    if (isUniqueViolation(error)) throw new AppError("CONFLICT", "Cet encaissement est déjà annulé.");
    throw error;
  }
}
