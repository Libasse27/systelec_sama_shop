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
import { dispatchNotifications, queueNotifications } from "@/server/notifications/queue";
import type { ReturnMessageData } from "@/server/notifications/return-templates";
import { parseInput } from "@/server/validation";
import { RETURN_VERIFICATION_KIND_LABELS } from "@/lib/labels";
import { customerConcernedBy, RETURN_DECLARATION_HOURS } from "./policy";
import { maxRefundFor } from "./refund-cap";
import { answerVerificationSchema, createReturnSchema, decideReturnSchema, refundReturnSchema, requestVerificationSchema } from "./schemas";

type Tx = Prisma.TransactionClient;

/**
 * Recalcule le statut de paiement d'une commande (retours compris) sous son verrou, et
 * l'historise s'il change.
 */
async function refreshPaymentStatus(tx: Tx, orderId: string, actorId: string | null, comment: string): Promise<void> {
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
      declaredBy: true,
      decidedById: true,
      lateDeclaration: true,
      order: { select: { customer: { select: { userId: true } } } },
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

/**
 * Informe le client de l'évolution de sa demande (phase 10, décision 2) par e-mail, s'il en a laissé un
 * (envoyé seulement si le service est configuré). Rattaché au retour.
 */
async function notifyReturnCustomer(
  tx: Tx,
  returnId: string,
  template: "return.declared_customer" | "return.verification_customer" | "return.decided_customer",
  extra: Omit<ReturnMessageData, "number" | "orderNumber" | "customerName"> = {},
): Promise<void> {
  const row = await tx.return.findUniqueOrThrow({ where: { id: returnId }, select: { number: true, order: { select: { number: true, contact: true } } } });
  const contact = row.order.contact as unknown as Contact;
  if (!contact.email) return;
  await queueNotifications(tx, { returnId }, template, { number: row.number, orderNumber: row.order.number, customerName: contact.name, ...extra }, { email: contact.email, phone: null });
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

/** Qui déclare : le personnel au nom du client, ou le client lui-même (compte, ou invité sans compte). */
export type ReturnDeclarer = { kind: "staff"; actorId: string } | { kind: "customer"; userId: string | null; ip?: string };

/** Photo déjà stockée (dossier privé du retour), à rattacher dans la transaction. */
export interface StoredPhoto {
  key: string;
  contentType: string;
  byteSize: number;
}

export interface NewReturn {
  /** Identifiant imposé quand les photos sont stockées avant l'enregistrement (dossier du retour). */
  id?: string;
  orderId: string;
  idempotencyKey: string;
  reason: string;
  items: { orderItemId: string; quantity: number }[];
  declarer: ReturnDeclarer;
  photos?: readonly StoredPhoto[];
}

/**
 * Enregistre un retour sous le verrou de la commande (déjà pris par l'appelant) : quantité retournée ≤
 * quantité livrée (retours précédents déduits, refusés exceptés), valeur au prix figé. Le retour est
 * « à vérifier » : la commande passe au statut de paiement « À vérifier ». Décision 2 : une déclaration
 * après 48 h (remise au client) est ACCEPTÉE mais marquée « hors délai » (calculé par la base).
 * Historique : « déclaré » (par le personnel, ou par le client : details.by = customer).
 */
export async function insertReturn(tx: Tx, data: NewReturn): Promise<Omit<RecordedReturn, "replayed">> {
  const { orderId, idempotencyKey, reason, items, declarer } = data;
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
  const byCustomer = declarer.kind === "customer";
  const actorId = byCustomer ? declarer.userId : declarer.actorId;
  const photos = data.photos ?? [];
  const created = await tx.return.create({
    data: {
      ...(data.id && { id: data.id }),
      number,
      orderId,
      idempotencyKey,
      reason,
      itemsValue,
      createdById: byCustomer ? null : declarer.actorId,
      declaredBy: byCustomer ? "CUSTOMER" : "STAFF",
      handedOverAt,
      declarationDeadline: new Date(handedOverAt.getTime() + RETURN_DECLARATION_HOURS * 3_600_000),
      items: { create: lines },
      attachments: { create: photos.map((photo) => ({ storageKey: photo.key, contentType: photo.contentType, byteSize: photo.byteSize })) },
    },
    select: { id: true, lateDeclaration: true, declarationDeadline: true },
  });
  const { lateDeclaration } = created;
  await recordReturnEvent(tx, created.id, {
    type: "DECLARED",
    fromStatus: null,
    toStatus: "RECEIVED",
    actorId,
    comment: reason,
    details: { lateDeclaration, ...(byCustomer && { by: "customer", photos: photos.length }) },
  });
  await refreshPaymentStatus(tx, orderId, actorId, `Retour ${number} à vérifier${byCustomer ? " (déclaré par le client)" : ""}${lateDeclaration ? " (déclaré hors délai)" : ""}`);
  await recordAudit(tx, {
    actorId,
    action: byCustomer ? "return.customer_declare" : "return.create",
    entityType: "Return",
    entityId: created.id,
    ...(byCustomer && declarer.ip && { ip: declarer.ip }),
    after: { number, orderId, reason, itemsValue, lines, lateDeclaration, declarationDeadline: created.declarationDeadline, ...(byCustomer && { photos: photos.length }) },
  });
  if (byCustomer) await notifyReturnCustomer(tx, created.id, "return.declared_customer", { lateDeclaration });
  return { id: created.id, number, lateDeclaration };
}

/**
 * Déclare un retour d'articles sur une commande remise au client (orders.update), au nom du client
 * (client présent en boutique ou au téléphone), voir insertReturn. Idempotent : un double envoi
 * n'enregistre qu'un retour.
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
      return { ...(await insertReturn(tx, { orderId, idempotencyKey, reason, items, declarer: { kind: "staff", actorId: actor.id } })), replayed: false };
    });
  } catch (error) {
    if (isUniqueViolation(error)) throw new AppError("CONFLICT", "Ce retour a déjà été envoyé.");
    throw error;
  }
}

/**
 * Déclarant du retour : le membre du personnel qui l'a enregistré, ou, s'il a été déclaré en ligne, le
 * titulaire du compte client de la commande (un employé qui commande pour lui-même n'examine pas sa
 * propre demande). Contrôlé aussi en base (triggers returns_check_update et returns_check_customer_declarer).
 */
function isDeclarer(current: Awaited<ReturnType<typeof lockReturn>>, actor: Actor): boolean {
  return current.createdById === actor.id || (current.declaredBy === "CUSTOMER" && current.order.customer.userId === actor.id);
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
    const result = await client.$transaction(async (tx) => {
      await lockOrderRow(tx, orderId);
      const current = await lockReturn(tx, returnId);
      if (current.status === "VERIFICATION") throw new AppError("CONFLICT", "Une vérification est en attente : enregistrez d'abord sa réponse ou son résultat.");
      if (current.status !== "RECEIVED") throw new AppError("CONFLICT", "Ce retour a déjà été traité.");
      if (isDeclarer(current, actor)) throw new SelfDecisionError();
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
      // Le motif n'est communiqué au client qu'en cas de refus ; l'état des articles reste interne.
      await notifyReturnCustomer(
        tx,
        returnId,
        "return.decided_customer",
        decision.decision === "REJECT"
          ? { decision: "REJECTED", decisionNote: decision.note }
          : { decision: "ACCEPTED", ...(decision.refundAmount > 0 && { refundAmount: formatFcfa(decision.refundAmount) }) },
      );
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
    await dispatchNotifications(client, { returnId });
    return result;
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
    await dispatchNotifications(client, { returnId });
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
    if (isDeclarer(current, actor)) throw new SelfDecisionError();
    await tx.return.update({ where: { id: returnId }, data: { status: "VERIFICATION" } });
    await recordReturnEvent(tx, returnId, { type: "VERIFICATION_REQUESTED", fromStatus: "RECEIVED", toStatus: "VERIFICATION", actorId: actor.id, comment: request, verificationKind: kind });
    await refreshPaymentStatus(tx, orderId, actor.id, `Retour ${current.number} : vérification demandée`);
    if (customerConcernedBy(kind)) {
      await notifyReturnCustomer(tx, returnId, "return.verification_customer", { verificationKind: RETURN_VERIFICATION_KIND_LABELS[kind], request, reminder: 0 });
    }
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
    if (isDeclarer(current, actor)) throw new SelfDecisionError();
    await tx.return.update({ where: { id: returnId }, data: { status: "RECEIVED" } });
    await recordReturnEvent(tx, returnId, { type: "VERIFICATION_ANSWERED", fromStatus: "VERIFICATION", toStatus: "RECEIVED", actorId: actor.id, comment: response });
    await recordAudit(tx, { actorId: actor.id, action: "return.verification.answer", entityType: "Return", entityId: returnId, before: { status: current.status }, after: { status: "RECEIVED", response } });
  });
}

/**
 * Réponse du CLIENT à une vérification qui l'attend (photos, facture, informations), sous les verrous
 * de la commande (pris par l'appelant) puis du retour : le retour revient « à vérifier » et sera examiné
 * par un responsable ; la réponse ne décide jamais rien. Photos déjà stockées, rattachées ici.
 */
export async function recordCustomerAnswer(
  tx: Tx,
  returnId: string,
  answer: { response: string; userId: string | null; ip?: string; photos: readonly StoredPhoto[]; maxPhotosPerReturn: number },
): Promise<void> {
  const current = await lockReturn(tx, returnId);
  if (current.status !== "VERIFICATION") throw new AppError("CONFLICT", "Aucune information n'est attendue de votre part sur ce retour.");
  const request = await tx.returnEvent.findFirst({ where: { returnId, type: "VERIFICATION_REQUESTED" }, orderBy: [{ createdAt: "desc" }, { id: "desc" }], select: { verificationKind: true } });
  if (!request?.verificationKind || !customerConcernedBy(request.verificationKind)) {
    throw new AppError("CONFLICT", "La vérification demandée se fait en boutique : contactez-nous ou passez nous voir.");
  }
  const existingPhotos = await tx.returnAttachment.count({ where: { returnId } });
  if (existingPhotos + answer.photos.length > answer.maxPhotosPerReturn) {
    throw new ValidationError("Trop de photos pour ce retour.", { fieldErrors: { photos: [`${answer.maxPhotosPerReturn} photos au plus par retour`] } });
  }
  await tx.return.update({
    where: { id: returnId },
    data: { status: "RECEIVED", attachments: { create: answer.photos.map((photo) => ({ storageKey: photo.key, contentType: photo.contentType, byteSize: photo.byteSize })) } },
  });
  await recordReturnEvent(tx, returnId, {
    type: "VERIFICATION_ANSWERED",
    fromStatus: "VERIFICATION",
    toStatus: "RECEIVED",
    actorId: answer.userId,
    comment: answer.response,
    details: { by: "customer", photos: answer.photos.length },
  });
  await recordAudit(tx, {
    actorId: answer.userId,
    action: "return.customer_answer",
    entityType: "Return",
    entityId: returnId,
    ...(answer.ip && { ip: answer.ip }),
    before: { status: "VERIFICATION" },
    after: { status: "RECEIVED", photos: answer.photos.length },
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

/** Remboursement tenté par la personne qui a décidé le retour, sans la permission d'exception (constaté sous verrou). */
class SelfRefundError extends Error {}

/**
 * Décision 1 (phase 10) : la personne qui a décidé le retour ne verse pas elle-même le remboursement.
 * Exception (un seul administrateur disponible) : permission returns.refund_own_decision et motif
 * obligatoire, inscrit sur le retour, dans son historique et au journal d'audit. Renvoie le motif retenu.
 */
function selfApprovalFor(actor: Actor, decidedById: string | null, selfApprovalNote: string | null): string | null {
  if (decidedById !== actor.id) return null;
  if (!actor.permissions.has("returns.refund_own_decision")) throw new SelfRefundError();
  if (!selfApprovalNote) {
    throw new ValidationError("Vous avez décidé ce retour : motivez l'exception pour verser vous-même le remboursement.", {
      fieldErrors: { selfApprovalNote: ["Motif de l'exception requis (ex. : seul administrateur disponible)"] },
    });
  }
  return selfApprovalNote;
}

/**
 * Verse en espèces le remboursement d'un retour accepté (payments.correct) : validation DISTINCTE et
 * explicite d'une personne autorisée, après l'acceptation (jamais automatique), et par une AUTRE
 * personne que celle qui a décidé (sauf exception motivée, voir selfApprovalFor ; contrôlé aussi en
 * base). Écriture négative liée au retour, avec son reçu ; montant encaissé de la commande diminué
 * d'autant, montant remboursé augmenté, statut « Remboursement effectué ». Jamais au-delà des espèces
 * encaissées (contrôlé aussi en base). Idempotent ; un retour n'est remboursé qu'une fois (unicité en base).
 */
export async function refundReturn(client: PrismaClient, actor: Actor, returnId: string, input: unknown): Promise<RecordedRefund> {
  await assertPermission(client, actor, "payments.correct");
  const { idempotencyKey, note, selfApprovalNote } = parseInput(refundReturnSchema, input, "Remboursement");
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
      const refundExceptionNote = selfApprovalFor(actor, current.decidedById, selfApprovalNote);
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
      await tx.return.update({ where: { id: returnId }, data: { status: "COMPLETED", refundedAt: new Date(), refundExceptionNote } });
      await recordReturnEvent(tx, returnId, {
        type: "REFUNDED",
        fromStatus: "REFUND_PENDING",
        toStatus: "COMPLETED",
        actorId: actor.id,
        comment: refundExceptionNote ? `${reason} — exception (décideur) : ${refundExceptionNote}` : reason,
        details: { amount, receiptNumber, ...(refundExceptionNote && { selfApproval: true, refundExceptionNote }) },
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
        after: {
          receiptNumber,
          amount,
          amountPaid: order.amountPaid - amount,
          refundedAmount: order.refundedAmount + amount,
          ...(refundExceptionNote && { selfApproval: true, refundExceptionNote }),
        },
      });
      return { receiptNumber, replayed: false };
    });
  } catch (error) {
    if (isUniqueViolation(error)) throw new AppError("CONFLICT", "Ce retour est déjà remboursé.");
    if (error instanceof SelfRefundError) {
      await recordAudit(client, { actorId: actor.id, action: "authz.denied", entityType: "Return", entityId: returnId, result: "DENIED", after: { rule: "return.decider_cannot_refund" } });
      throw new AppError("FORBIDDEN", "Vous avez décidé ce retour : une autre personne autorisée doit verser le remboursement.");
    }
    throw error;
  }
  if (!refund.replayed) await dispatchOrderNotifications(client, orderId);
  return refund;
}
