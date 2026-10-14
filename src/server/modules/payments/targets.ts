import "server-only";
import type { OrderStatus, PaymentStatus, Prisma } from "@/generated/prisma/client";
import { AppError } from "@/server/errors";
import { lockOrderRow } from "@/server/modules/orders/lock";
import type { Contact } from "@/server/modules/orders/schemas";
import { queueNotifications } from "@/server/notifications/queue";
import { PAYABLE_ORDER_STATUSES, paymentStatusFor } from "./balance";

type Tx = Prisma.TransactionClient;

/** Ce qu'un encaissement règle : une commande, ou une intervention (après la prestation). */
export type PaymentTarget = { kind: "order"; id: string } | { kind: "intervention"; id: string };

/** Colonne de rattachement d'un encaissement ou d'une notification. */
export const targetLink = (target: PaymentTarget): { orderId: string } | { interventionId: string } =>
  target.kind === "order" ? { orderId: target.id } : { interventionId: target.id };

export function targetOf(payment: { orderId: string | null; interventionId: string | null }): PaymentTarget {
  if (payment.orderId) return { kind: "order", id: payment.orderId };
  if (payment.interventionId) return { kind: "intervention", id: payment.interventionId };
  throw new AppError("INTERNAL", "Encaissement sans commande ni intervention.");
}

export interface PaymentNotice {
  amount: number;
  balance: number;
  receiptNumber: string;
}

/** Cible verrouillée : solde exact, règles d'encaissement et effets propres à son type. */
export interface LockedTarget {
  number: string;
  total: number;
  amountPaid: number;
  paymentStatus: PaymentStatus;
  /** Motif de refus d'un encaissement, ou null s'il est permis. */
  notPayable: string | null;
  /** Motif de refus d'une contre-écriture, ou null si elle est permise. */
  notVoidable: string | null;
  /** Reporte une écriture sur le solde ; renvoie le nouveau statut de paiement. */
  apply(amount: number, actorId: string, comment: string): Promise<PaymentStatus>;
  notify(payment: PaymentNotice): Promise<void>;
}

const ORDER_NOT_PAYABLE: Partial<Record<OrderStatus, string>> = {
  PENDING_CONFIRMATION: "Confirmez la commande avant d'encaisser.",
  CANCELLED: "Une commande annulée ne s'encaisse pas.",
  CLOSED: "Cette commande est déjà remise au client et soldée.",
};

/**
 * Verrouille la cible (FOR UPDATE) : encaissements, contre-écritures et changements de statut
 * d'un même document s'exécutent l'un après l'autre, sur un solde toujours exact.
 */
export function lockTarget(tx: Tx, target: PaymentTarget): Promise<LockedTarget> {
  return target.kind === "order" ? lockOrderTarget(tx, target.id) : lockInterventionTarget(tx, target.id);
}

async function lockOrderTarget(tx: Tx, orderId: string): Promise<LockedTarget> {
  await lockOrderRow(tx, orderId);
  const order = await tx.order.findUniqueOrThrow({
    where: { id: orderId },
    select: { number: true, status: true, paymentStatus: true, total: true, amountPaid: true, fulfillmentMethod: true, contact: true },
  });
  const contact = order.contact as unknown as Contact;
  return {
    number: order.number,
    total: order.total,
    amountPaid: order.amountPaid,
    paymentStatus: order.paymentStatus,
    notPayable: PAYABLE_ORDER_STATUSES.includes(order.status) ? null : (ORDER_NOT_PAYABLE[order.status] ?? "Cette commande ne s'encaisse pas."),
    // Commande remise : stock sorti et commande soldée ; la correction passera par un retour (phase 9).
    notVoidable: order.status === "CLOSED" ? "Commande déjà remise au client : un encaissement ne s'y annule plus." : null,
    async apply(amount, actorId, comment) {
      const amountPaid = order.amountPaid + amount;
      const paymentStatus = paymentStatusFor(order.total, amountPaid);
      await tx.order.update({ where: { id: orderId }, data: { amountPaid, paymentStatus } });
      await tx.orderStatusHistory.create({ data: { orderId, field: "PAYMENT", from: order.paymentStatus, to: paymentStatus, actorId, comment } });
      return paymentStatus;
    },
    notify: (payment) =>
      queueNotifications(
        tx,
        { orderId },
        "order.payment",
        { number: order.number, customerName: contact.name, total: order.total, fulfillment: order.fulfillmentMethod, payment },
        { email: contact.email, phone: contact.phone },
      ),
  };
}

/** Verrou d'une intervention (même règle que pour une commande : ce verrou en premier). */
export async function lockInterventionRow(tx: Tx, interventionId: string): Promise<void> {
  const [locked] = await tx.$queryRaw<{ id: string }[]>`SELECT id FROM interventions WHERE id = ${interventionId} FOR UPDATE`;
  if (!locked) throw new AppError("NOT_FOUND", "Intervention introuvable.");
}

async function lockInterventionTarget(tx: Tx, interventionId: string): Promise<LockedTarget> {
  await lockInterventionRow(tx, interventionId);
  const intervention = await tx.intervention.findUniqueOrThrow({
    where: { id: interventionId },
    select: { number: true, status: true, paymentStatus: true, amountDue: true, amountPaid: true, contact: true },
  });
  const contact = intervention.contact as unknown as Contact;
  const notPayable =
    intervention.status === "DONE"
      ? null
      : intervention.status === "CANCELLED"
        ? "Une intervention annulée ne s'encaisse pas."
        : "Une intervention s'encaisse après la prestation : terminez-la d'abord.";
  return {
    number: intervention.number,
    total: intervention.amountDue,
    amountPaid: intervention.amountPaid,
    paymentStatus: intervention.paymentStatus,
    notPayable,
    notVoidable: null,
    async apply(amount) {
      const amountPaid = intervention.amountPaid + amount;
      const paymentStatus = paymentStatusFor(intervention.amountDue, amountPaid);
      await tx.intervention.update({ where: { id: interventionId }, data: { amountPaid, paymentStatus } });
      return paymentStatus;
    },
    notify: (payment) =>
      queueNotifications(
        tx,
        { interventionId },
        "intervention.payment",
        { number: intervention.number, customerName: contact.name, payment },
        { email: contact.email, phone: contact.phone },
      ),
  };
}
