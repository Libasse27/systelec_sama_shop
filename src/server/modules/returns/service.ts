import "server-only";
import type { Prisma, PrismaClient, ReturnEventType, ReturnExceptionGround, ReturnStatus, ReturnVerificationKind } from "@/generated/prisma/client";
import { businessYear } from "@/lib/dates";
import { formatFcfa } from "@/lib/money";
import { recordAudit } from "@/server/audit/audit";
import { assertPermission, type Actor } from "@/server/authz/service";
import { isUniqueViolation } from "@/server/db/errors";
import { AppError, ValidationError } from "@/server/errors";
import { lockStock } from "@/server/modules/inventory/reservations";
import { lockOrderRow } from "@/server/modules/orders/lock";
import type { Contact } from "@/server/modules/orders/schemas";
import { orderPaymentStatus } from "@/server/modules/payments/balance";
import { nextBusinessNumber } from "@/server/modules/sequences/service";
import { dispatchOrderNotifications, queueOrderNotifications } from "@/server/notifications/order-notifications";
import { parseInput } from "@/server/validation";
import { RETURN_DECLARATION_HOURS } from "./policy";
import { maxRefundFor } from "./refund-cap";
import { answerVerificationSchema, createReturnSchema, decideReturnSchema, refundReturnSchema, requestVerificationSchema } from "./schemas";

type Tx = Prisma.TransactionClient;

/**
 * Recalcule le statut de paiement d'une commande (retours compris) sous son verrou, et
 * l'historise s'il change.
 */
async function refreshPaymentStatus(tx: Tx, orderId: string, actorId: string, comment: string): Promise<void> {
  const order = await tx.order.findUniqueOrThrow({
    where: { id: orderId },
    select: { total: true, amountPaid: true, refundedAmount: true, paymentStatus: true, returns: { select: { status: true } } },
  });
  const next = orderPaymentStatus({ ...order, returns: order.returns.map((entry) => entry.status) });
  if (next === order.paymentStatus) return;
  await tx.order.update({ where: { id: orderId }, data: { paymentStatus: next } });
  await tx.orderStatusHistory.create({ data: { orderId, field: "PAYMENT", from: order.paymentStatus, to: next, actorId, comment } });
}

/** Verrouille le retour (après la commande : même ordre partout) et le relit. */
async function lockReturn(tx: Tx, returnId: string) {
  await tx.$queryRaw`SELECT id FROM returns WHERE id = ${returnId} FOR UPDATE`;
  return tx.return.findUniqueOrThrow({
    where: { id: returnId },
    select: {
      number: true,
      orderId: true,
      status: true,
      itemsValue: true,
      refundAmount: true,
      createdById: true,
      lateDeclaration: true,
      items: { select: { quantity: true, orderItem: { select: { variantId: true } } } },
    },
  });
}

interface ReturnEventInput {
  type: ReturnEventType;
  fromStatus: ReturnStatus | null;
  toStatus: ReturnStatus;
  actorId: string | null;
  comment?: string | null;
  verificationKind?: ReturnVerificationKind;
  details?: Prisma.InputJsonValue;
}

/** Ajoute une étape à l'historique propre du retour (ajout seul, statut contrôlé en base). */
export async function recordReturnEvent(tx: Tx, returnId: string, event: ReturnEventInput): Promise<void> {
  await tx.returnEvent.create({ data: { returnId, ...event, comment: event.comment ?? null } });
}

async function orderOfReturn(client: PrismaClient, returnId: string): Promise<string> {
  const found = await client.return.findUnique({ where: { id: returnId }, select: { orderId: true } });
  if (!found) throw new AppError("NOT_FOUND", "Retour introuvable.");
  return found.orderId;
}

export interface RecordedReturn {
  id: string;
  number: string;
  replayed: boolean;
  /** Déclaré après le délai commercial de 48 h (enregistré quand même, signalé). */
  lateDeclaration: boolean;
}

/**
 * Déclare un retour d'articles sur une commande remise au client (orders.update), au nom du client :
 * quantité retournée ≤ quantité livrée (retours précédents déduits, refusés exceptés), valeur au prix
 * figé. Le retour est « à vérifier » : la commande passe au statut de paiement « À vérifier ».
 * Décision 2 : une déclaration après 48 h (remise au client) est ACCEPTÉE mais marquée « hors délai »
 * (calculé par la base) ; elle n'est jamais refusée à l'enregistrement. Historique : « déclaré ».
 * Idempotent : un double envoi n'enregistre qu'un retour.
 */
export async function createReturn(client: PrismaClient, actor: Actor, orderId: string, input: unknown): Promise<RecordedReturn> {
  await assertPermission(client, actor, "orders.update");
  const { idempotencyKey, reason, items } = parseInput(createReturnSchema, input, "Retour");
  try {
    return await client.$transaction(async (tx) => {
      await lockOrderRow(tx, orderId);
      const existing = await tx.return.findUnique({ where: { idempotencyKey }, select: { id: true, number: true, orderId: true, lateDeclaration: true } });
      if (existing) {
        if (existing.orderId !== orderId) throw new AppError("CONFLICT", "Ce retour a déjà été envoyé.");
        return { id: existing.id, number: existing.number, replayed: true, lateDeclaration: existing.lateDeclaration };
      }
      const order = await tx.order.findUniqueOrThrow({
        where: { id: orderId },
        select: { status: true, closedAt: true, items: { select: { id: true, quantity: true, unitPrice: true, productName: true, returnItems: { where: { return: { status: { not: "REJECTED" } } }, select: { quantity: true } } } } },
      });
      if (order.status !== "CLOSED") throw new AppError("CONFLICT", "Seule une commande remise au client peut faire l'objet d'un retour.");
      const lines = items.map((requested) => {
        const item = order.items.find((candidate) => candidate.id === requested.orderItemId);
        if (!item) throw new AppError("VALIDATION", "Article inconnu dans cette commande.");
        const remaining = item.quantity - item.returnItems.reduce((sum, line) => sum + line.quantity, 0);
        if (requested.quantity > remaining) {
          throw new AppError("CONFLICT", `${item.productName} : ${remaining} article(s) au plus peuvent encore être retournés.`);
        }
        return { orderItemId: item.id, quantity: requested.quantity, unitPrice: item.unitPrice };
      });
      const itemsValue = lines.reduce((sum, line) => sum + line.quantity * line.unitPrice, 0);
      const number = await nextBusinessNumber(tx, "return", businessYear());
      // Remise et délai : recalculés par la base (trigger), qui fait foi.
      const handedOverAt = order.closedAt ?? new Date();
      const created = await tx.return.create({
        data: {
          number,
          orderId,
          idempotencyKey,
          reason,
          itemsValue,
          createdById: actor.id,
          handedOverAt,
          declarationDeadline: new Date(handedOverAt.getTime() + RETURN_DECLARATION_HOURS * 3_600_000),
          items: { create: lines },
        },
        select: { id: true, lateDeclaration: true, declarationDeadline: true },
      });
      const { lateDeclaration } = created;
      await recordReturnEvent(tx, created.id, { type: "DECLARED", fromStatus: null, toStatus: "RECEIVED", actorId: actor.id, comment: reason, details: { lateDeclaration } });
      await refreshPaymentStatus(tx, orderId, actor.id, `Retour ${number} à vérifier${lateDeclaration ? " (déclaré hors délai)" : ""}`);
      await recordAudit(tx, {
        actorId: actor.id,
        action: "return.create",
        entityType: "Return",
        entityId: created.id,
        after: { number, orderId, reason, itemsValue, lines, lateDeclaration, declarationDeadline: created.declarationDeadline },
      });
      return { id: created.id, number, replayed: false, lateDeclaration };
    });
  } catch (error) {
    if (isUniqueViolation(error)) throw new AppError("CONFLICT", "Ce retour a déjà été envoyé.");
    throw error;
  }
}

/** Refus d'un examen (décision, résultat de vérification) par la personne qui a déclaré le retour (constaté sous verrou). */
class SelfDecisionError extends Error {}

/** Journalise le refus hors de la transaction annulée. */
async function denySelfReview(client: PrismaClient, actor: Actor, returnId: string): Promise<void> {
  await recordAudit(client, { actorId: actor.id, action: "authz.denied", entityType: "Return", entityId: returnId, result: "DENIED", after: { rule: "return.declarer_cannot_review" } });
}

/**
 * Décision sur un retour à examiner (returns.decide), toujours motivée, définitive (contrôlé aussi en base) :
 * - validation indépendante : la personne qui a déclaré le retour ne peut pas le décider (vérifié sous
 *   verrou, refus journalisé, contrôlé aussi en base) ;
 * - une vérification demandée doit d'abord recevoir sa réponse ;
 * - acceptation : remise en stock ou non (articles abîmés), montant à rembourser ≤ valeur des
 *   articles remise déduite (maxRefundFor) et ≤ espèces encore détenues (autres remboursements attendus
 *   déduits) ; un retour déclaré hors délai exige un fondement et un motif d'exception ;
 * - refus : les articles sont rendus au client, rien n'est remboursé.
 * Le remboursement n'est JAMAIS versé ici : il reste à valider par une personne autorisée (refundReturn).
 */
export async function decideReturn(client: PrismaClient, actor: Actor, returnId: string, input: unknown): Promise<{ status: ReturnStatus }> {
  await assertPermission(client, actor, "returns.decide");
  const decision = parseInput(decideReturnSchema, input, "Décision sur le retour");
  const orderId = await orderOfReturn(client, returnId);
  try {
    return await client.$transaction(async (tx) => {
      await lockOrderRow(tx, orderId);
      const current = await lockReturn(tx, returnId);
      if (current.status === "VERIFICATION") throw new AppError("CONFLICT", "Une vérification est en attente : enregistrez d'abord sa réponse ou son résultat.");
      if (current.status !== "RECEIVED") throw new AppError("CONFLICT", "Ce retour a déjà été traité.");
      if (current.createdById === actor.id) throw new SelfDecisionError();
      const decided = { decidedAt: new Date(), decidedById: actor.id, decisionNote: decision.note };

      let status: ReturnStatus;
      let exception: { exceptionGround: ReturnExceptionGround; exceptionNote: string } | null = null;
      if (decision.decision === "REJECT") {
        status = "REJECTED";
        await tx.return.update({ where: { id: returnId }, data: { ...decided, status } });
      } else {
        if (current.lateDeclaration) {
          if (!decision.exceptionGround || !decision.exceptionNote) {
            throw new ValidationError("Retour déclaré hors délai : indiquez le fondement et le motif de l'exception pour l'accepter.", {
              fieldErrors: {
                ...(!decision.exceptionGround && { exceptionGround: ["Fondement requis (garantie, vice caché, obligation légale…)"] }),
                ...(!decision.exceptionNote && { exceptionNote: ["Motif de l'exception requis"] }),
              },
            });
          }
          exception = { exceptionGround: decision.exceptionGround, exceptionNote: decision.exceptionNote };
        }
        const order = await tx.order.findUniqueOrThrow({
          where: { id: orderId },
          select: { amountPaid: true, subtotal: true, discountTotal: true, returns: { where: { status: "REFUND_PENDING" }, select: { refundAmount: true } } },
        });
        const cap = maxRefundFor(current.itemsValue, order);
        if (decision.refundAmount > cap) {
          throw new AppError("CONFLICT", `Le remboursement ne peut dépasser la valeur des articles retournés, remise déduite (${formatFcfa(cap)}).`);
        }
        const refundable = order.amountPaid - order.returns.reduce((sum, entry) => sum + entry.refundAmount, 0);
        if (decision.refundAmount > refundable) {
          throw new AppError("CONFLICT", `Le remboursement ne peut dépasser les espèces encaissées restantes (${formatFcfa(Math.max(0, refundable))}).`);
        }
        if (decision.restock) await restock(tx, actor, orderId, current);
        status = decision.refundAmount > 0 ? "REFUND_PENDING" : "COMPLETED";
        await tx.return.update({
          where: { id: returnId },
          data: { ...decided, ...exception, status, restocked: decision.restock, refundAmount: decision.refundAmount },
        });
      }
      const details = decision.decision === "REJECT" ? null : { refundAmount: decision.refundAmount, restocked: decision.restock, ...exception };
      await recordReturnEvent(tx, returnId, {
        type: decision.decision === "REJECT" ? "REJECTED" : "ACCEPTED",
        fromStatus: current.status,
        toStatus: status,
        actorId: actor.id,
        comment: decision.note,
        ...(details && { details }),
      });
      await refreshPaymentStatus(tx, orderId, actor.id, `Retour ${current.number} : ${decision.decision === "REJECT" ? "refusé" : "accepté"}`);
      await recordAudit(tx, {
        actorId: actor.id,
        action: "return.decide",
        entityType: "Return",
        entityId: returnId,
        before: { status: current.status },
        after: { status, decision: decision.decision, note: decision.note, ...details },
      });
      return { status };
    });
  } catch (error) {
    if (error instanceof SelfDecisionError) {
      await denySelfReview(client, actor, returnId);
      throw new AppError("FORBIDDEN", "Vous avez déclaré ce retour : un autre responsable doit l'accepter ou le refuser.");
    }
    throw error;
  }
}

/**
 * Demande une vérification avant de décider (returns.decide, jamais par le déclarant) : inspection physique, photos, facture
 * ou informations complémentaires, avec la demande précise. Le retour passe « vérification demandée »
 * (première action : le délai de traitement est tenu) et attend la réponse.
 */
export async function requestReturnVerification(client: PrismaClient, actor: Actor, returnId: string, input: unknown): Promise<void> {
  await assertPermission(client, actor, "returns.decide");
  const { kind, request } = parseInput(requestVerificationSchema, input, "Demande de vérification");
  const orderId = await orderOfReturn(client, returnId);
  try {
    await requestUnderLock(client, actor, orderId, returnId, kind, request);
  } catch (error) {
    if (error instanceof SelfDecisionError) {
      // Sinon le déclarant pourrait « commencer » lui-même le traitement et neutraliser l'alerte de délai.
      await denySelfReview(client, actor, returnId);
      throw new AppError("FORBIDDEN", "Vous avez déclaré ce retour : un autre responsable doit l'examiner.");
    }
    throw error;
  }
}

async function requestUnderLock(client: PrismaClient, actor: Actor, orderId: string, returnId: string, kind: ReturnVerificationKind, request: string): Promise<void> {
  await client.$transaction(async (tx) => {
    await lockOrderRow(tx, orderId);
    const current = await lockReturn(tx, returnId);
    if (current.status === "VERIFICATION") throw new AppError("CONFLICT", "Une vérification est déjà en attente de réponse.");
    if (current.status !== "RECEIVED") throw new AppError("CONFLICT", "Ce retour a déjà été traité.");
    if (current.createdById === actor.id) throw new SelfDecisionError();
    await tx.return.update({ where: { id: returnId }, data: { status: "VERIFICATION" } });
    await recordReturnEvent(tx, returnId, { type: "VERIFICATION_REQUESTED", fromStatus: "RECEIVED", toStatus: "VERIFICATION", actorId: actor.id, comment: request, verificationKind: kind });
    await refreshPaymentStatus(tx, orderId, actor.id, `Retour ${current.number} : vérification demandée`);
    await recordAudit(tx, { actorId: actor.id, action: "return.verification.request", entityType: "Return", entityId: returnId, before: { status: current.status }, after: { status: "VERIFICATION", kind, request } });
  });
}

/**
 * Enregistre la réponse ou le résultat de la vérification demandée (returns.decide). Validation
 * indépendante : la personne qui a déclaré le retour ne fournit pas elle-même le résultat que le
 * décideur va lire (vérifié sous verrou, refus journalisé). Le retour revient « à vérifier ».
 */
export async function answerReturnVerification(client: PrismaClient, actor: Actor, returnId: string, input: unknown): Promise<void> {
  await assertPermission(client, actor, "returns.decide");
  const { response } = parseInput(answerVerificationSchema, input, "Réponse à la vérification");
  const orderId = await orderOfReturn(client, returnId);
  try {
    await answerUnderLock(client, actor, orderId, returnId, response);
  } catch (error) {
    if (error instanceof SelfDecisionError) {
      await denySelfReview(client, actor, returnId);
      throw new AppError("FORBIDDEN", "Vous avez déclaré ce retour : un autre responsable doit enregistrer le résultat de la vérification.");
    }
    throw error;
  }
}

async function answerUnderLock(client: PrismaClient, actor: Actor, orderId: string, returnId: string, response: string): Promise<void> {
  await client.$transaction(async (tx) => {
    await lockOrderRow(tx, orderId);
    const current = await lockReturn(tx, returnId);
    if (current.status !== "VERIFICATION") throw new AppError("CONFLICT", "Aucune vérification n'est en attente sur ce retour.");
    if (current.createdById === actor.id) throw new SelfDecisionError();
    await tx.return.update({ where: { id: returnId }, data: { status: "RECEIVED" } });
    await recordReturnEvent(tx, returnId, { type: "VERIFICATION_ANSWERED", fromStatus: "VERIFICATION", toStatus: "RECEIVED", actorId: actor.id, comment: response });
    await recordAudit(tx, { actorId: actor.id, action: "return.verification.answer", entityType: "Return", entityId: returnId, before: { status: current.status }, after: { status: "RECEIVED", response } });
  });
}

/** Remise en stock des articles retournés (mouvement RETURN motivé, verrou de stock après la commande). */
async function restock(tx: Tx, actor: Actor, orderId: string, current: Awaited<ReturnType<typeof lockReturn>>): Promise<void> {
  const levels = await lockStock(tx, current.items.map((item) => item.orderItem.variantId));
  for (const item of current.items) {
    const level = levels.get(item.orderItem.variantId);
    if (!level) throw new AppError("INTERNAL", "Ligne de stock non verrouillée.");
    const onHand = level.onHand + item.quantity;
    await tx.inventory.update({ where: { variantId: level.variantId }, data: { onHand } });
    await tx.stockMovement.create({
      data: {
        variantId: level.variantId,
        type: "RETURN",
        quantity: item.quantity,
        onHandAfter: onHand,
        reservedAfter: level.reserved,
        reason: `Retour ${current.number}`,
        actorId: actor.id,
        orderId,
      },
    });
    levels.set(level.variantId, { ...level, onHand });
  }
}

export interface RecordedRefund {
  receiptNumber: string;
  replayed: boolean;
}

/**
 * Verse en espèces le remboursement d'un retour accepté (payments.correct) : validation DISTINCTE et
 * explicite d'une personne autorisée, après l'acceptation (jamais automatique). Écriture négative
 * liée au retour, avec son reçu ; montant encaissé de la commande diminué d'autant, montant
 * remboursé augmenté, statut « Remboursement effectué ». Jamais au-delà des espèces encaissées
 * (contrôlé aussi en base). Idempotent ; un retour n'est remboursé qu'une fois (unicité en base).
 */
export async function refundReturn(client: PrismaClient, actor: Actor, returnId: string, input: unknown): Promise<RecordedRefund> {
  await assertPermission(client, actor, "payments.correct");
  const { idempotencyKey, note } = parseInput(refundReturnSchema, input, "Remboursement");
  const orderId = await orderOfReturn(client, returnId);
  let refund: RecordedRefund;
  try {
    refund = await client.$transaction(async (tx) => {
      await lockOrderRow(tx, orderId);
      const current = await lockReturn(tx, returnId);
      const existing = await tx.payment.findUnique({ where: { idempotencyKey }, select: { receiptNumber: true, returnId: true } });
      if (existing) {
        if (existing.returnId !== returnId) throw new AppError("CONFLICT", "Ce remboursement a déjà été envoyé.");
        return { receiptNumber: existing.receiptNumber, replayed: true };
      }
      if (current.status !== "REFUND_PENDING") throw new AppError("CONFLICT", "Ce retour n'attend aucun remboursement.");
      const order = await tx.order.findUniqueOrThrow({
        where: { id: orderId },
        select: { number: true, total: true, amountPaid: true, refundedAmount: true, contact: true, fulfillmentMethod: true },
      });
      const amount = current.refundAmount;
      if (amount > order.amountPaid) throw new AppError("CONFLICT", `Remboursement supérieur aux espèces encaissées (${formatFcfa(order.amountPaid)}).`);

      const receiptNumber = await nextBusinessNumber(tx, "receipt", businessYear());
      const reason = `Remboursement du retour ${current.number}`;
      await tx.payment.create({
        data: {
          receiptNumber,
          orderId,
          amount: -amount,
          // Reste à payer inchangé : la commande reste réglée, une partie est rendue au client.
          balanceAfter: order.total - order.amountPaid - order.refundedAmount,
          recordedById: actor.id,
          idempotencyKey,
          returnId,
          reason,
          note,
        },
      });
      await tx.order.update({ where: { id: orderId }, data: { amountPaid: order.amountPaid - amount, refundedAmount: order.refundedAmount + amount } });
      await tx.return.update({ where: { id: returnId }, data: { status: "COMPLETED", refundedAt: new Date() } });
      await recordReturnEvent(tx, returnId, {
        type: "REFUNDED",
        fromStatus: "REFUND_PENDING",
        toStatus: "COMPLETED",
        actorId: actor.id,
        comment: reason,
        details: { amount, receiptNumber },
      });
      await refreshPaymentStatus(tx, orderId, actor.id, `${reason} : ${formatFcfa(amount)} en espèces (${receiptNumber})`);
      const contact = order.contact as unknown as Contact;
      await queueOrderNotifications(
        tx,
        orderId,
        "order.refund",
        { number: order.number, customerName: contact.name, total: order.total, fulfillment: order.fulfillmentMethod, refund: { amount, returnNumber: current.number, receiptNumber } },
        { email: contact.email, phone: contact.phone },
      );
      await recordAudit(tx, {
        actorId: actor.id,
        action: "payment.refund",
        entityType: "Return",
        entityId: returnId,
        before: { amountPaid: order.amountPaid, refundedAmount: order.refundedAmount },
        after: { receiptNumber, amount, amountPaid: order.amountPaid - amount, refundedAmount: order.refundedAmount + amount },
      });
      return { receiptNumber, replayed: false };
    });
  } catch (error) {
    if (isUniqueViolation(error)) throw new AppError("CONFLICT", "Ce retour est déjà remboursé.");
    throw error;
  }
  if (!refund.replayed) await dispatchOrderNotifications(client, orderId);
  return refund;
}
