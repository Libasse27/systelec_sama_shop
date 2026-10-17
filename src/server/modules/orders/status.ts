import "server-only";
import { z } from "zod";
import type { OrderStatus, Prisma, PrismaClient } from "@/generated/prisma/client";
import { ORDER_STATUS_LABELS } from "@/lib/labels";
import { formatFcfa } from "@/lib/money";
import { recordAudit } from "@/server/audit/audit";
import { assertPermission, type Actor } from "@/server/authz/service";
import { AppError } from "@/server/errors";
import { commitSale, lockStock, releaseStock } from "@/server/modules/inventory/reservations";
import { dispatchOrderNotifications, queueOrderNotifications } from "@/server/notifications/order-notifications";
import { parseInput } from "@/server/validation";
import { lockOrderRow } from "./lock";
import type { Contact } from "./schemas";

type Tx = Prisma.TransactionClient;

/**
 * Transitions autorisées. Une commande se clôt (remise au client) depuis « prête » ;
 * elle s'annule à tout moment avant la clôture. Clôture et annulation sont définitives.
 */
export const ORDER_TRANSITIONS: Record<OrderStatus, readonly OrderStatus[]> = {
  PENDING_CONFIRMATION: ["CONFIRMED", "CANCELLED"],
  CONFIRMED: ["PREPARING", "CANCELLED"],
  PREPARING: ["READY_FOR_PICKUP", "READY_TO_SHIP", "CANCELLED"],
  READY_FOR_PICKUP: ["CLOSED", "CANCELLED"],
  READY_TO_SHIP: ["CLOSED", "CANCELLED"],
  CANCELLED: [],
  CLOSED: [],
};

export function allowedTransitions(status: OrderStatus, method: "DELIVERY" | "PICKUP"): OrderStatus[] {
  // « Prête au retrait » n'a de sens que pour un retrait, « prête à expédier » que pour une livraison.
  const irrelevant: OrderStatus = method === "PICKUP" ? "READY_TO_SHIP" : "READY_FOR_PICKUP";
  return ORDER_TRANSITIONS[status].filter((next) => next !== irrelevant);
}

const changeSchema = z
  .object({
    status: z.enum(Object.keys(ORDER_TRANSITIONS) as [OrderStatus, ...OrderStatus[]]),
    comment: z
      .string()
      .trim()
      .max(500)
      .optional()
      .nullable()
      .transform((value) => value || null),
  })
  .refine((change) => change.status !== "CANCELLED" || change.comment !== null, {
    message: "Indiquez le motif de l'annulation",
    path: ["comment"],
  });

/**
 * Applique un changement de statut sur une commande verrouillée. Annulation : le stock réservé
 * est libéré. Clôture (remise au client) : le stock réservé sort définitivement (vente).
 * Une commande suivie par une livraison se clôt en marquant la livraison effectuée
 * (`viaDelivery`), et ne s'annule pas tant que le livreur est en route.
 */
export async function applyOrderTransition(
  tx: Tx,
  orderId: string,
  to: OrderStatus,
  actorId: string | null,
  comment: string | null,
  /** Condition revérifiée SOUS le verrou de la commande ; faux = rien n'est fait. */
  guard?: (order: { status: OrderStatus; reservedUntil: Date | null }) => boolean,
  viaDelivery = false,
): Promise<{ number: string; from: OrderStatus } | null> {
  await lockOrderRow(tx, orderId);
  const order = await tx.order.findUniqueOrThrow({
    where: { id: orderId },
    select: {
      number: true,
      status: true,
      reservedUntil: true,
      fulfillmentMethod: true,
      total: true,
      amountPaid: true,
      items: { select: { variantId: true, quantity: true } },
    },
  });
  if (guard && !guard(order)) return null;
  if (order.status === to) return null;
  if (!allowedTransitions(order.status, order.fulfillmentMethod).includes(to)) {
    throw new AppError("CONFLICT", `Passage impossible de « ${ORDER_STATUS_LABELS[order.status]} » à « ${ORDER_STATUS_LABELS[to]} ».`);
  }
  if (to === "CLOSED" || to === "CANCELLED") {
    const delivery = await tx.delivery.findUnique({ where: { orderId }, select: { status: true } });
    if (to === "CANCELLED" && delivery?.status === "IN_TRANSIT") {
      throw new AppError("CONFLICT", "Livraison en cours : enregistrez d'abord son résultat (livrée ou échec).");
    }
    if (to === "CLOSED" && delivery && !viaDelivery) {
      throw new AppError("CONFLICT", "Cette commande est suivie par une livraison : la remise se fait en marquant la livraison effectuée.");
    }
  }
  // Contrôlés sous le verrou de la commande, que les encaissements prennent aussi.
  if (to === "CLOSED" && order.amountPaid < order.total) {
    throw new AppError("CONFLICT", `Commande non soldée : encaissez le reste (${formatFcfa(order.total - order.amountPaid)}) avant la remise au client.`);
  }
  if (to === "CANCELLED" && order.amountPaid > 0) {
    throw new AppError(
      "CONFLICT",
      `Des encaissements sont enregistrés (${formatFcfa(order.amountPaid)}) : annulez-les par contre-écriture, en rendant les espèces, avant d'annuler la commande.`,
    );
  }

  if (to === "CANCELLED" || to === "CLOSED") {
    const levels = await lockStock(tx, order.items.map((item) => item.variantId));
    const apply = to === "CANCELLED" ? releaseStock : commitSale;
    const reason = to === "CANCELLED" ? `Annulation commande ${order.number}` : `Vente commande ${order.number}`;
    for (const item of order.items) {
      await apply(tx, levels, { variantId: item.variantId, quantity: item.quantity, orderId, reason, actorId });
    }
  }
  const now = new Date();
  await tx.order.update({
    where: { id: orderId },
    data: {
      status: to,
      ...(to === "CONFIRMED" && { confirmedAt: now, reservedUntil: null }),
      ...(to === "CANCELLED" && { cancelledAt: now }),
      ...(to === "CLOSED" && { closedAt: now }),
    },
  });
  await tx.orderStatusHistory.create({ data: { orderId, from: order.status, to, actorId, comment } });
  return { number: order.number, from: order.status };
}

/** Notifie le client d'un nouvel état de sa commande (libellé libre : statut ou étape de livraison). */
export async function notifyOrderCustomer(tx: Tx, orderId: string, statusLabel: string, comment: string | null): Promise<void> {
  const order = await tx.order.findUniqueOrThrow({ where: { id: orderId }, select: { number: true, total: true, contact: true, fulfillmentMethod: true } });
  const contact = order.contact as Contact;
  await queueOrderNotifications(
    tx,
    orderId,
    "order.status",
    { number: order.number, customerName: contact.name, total: order.total, fulfillment: order.fulfillmentMethod, statusLabel, comment },
    { email: contact.email, phone: contact.phone },
  );
}

/** Changement de statut par le personnel (permission orders.update), historisé, audité, notifié. */
export async function changeOrderStatus(client: PrismaClient, actor: Actor, orderId: string, input: unknown): Promise<void> {
  await assertPermission(client, actor, "orders.update");
  const { status, comment } = parseInput(changeSchema, input, "Changement de statut");
  const changed = await client.$transaction(async (tx) => {
    const result = await applyOrderTransition(tx, orderId, status, actor.id, comment);
    if (!result) return false;
    await notifyOrderCustomer(tx, orderId, ORDER_STATUS_LABELS[status], comment);
    await recordAudit(tx, {
      actorId: actor.id,
      action: "order.status",
      entityType: "Order",
      entityId: orderId,
      before: { status: result.from },
      after: { status, comment },
    });
    return true;
  });
  if (changed) await dispatchOrderNotifications(client, orderId);
}

/** Le client annule lui-même sa commande tant qu'elle n'est pas confirmée. */
export async function cancelOwnOrder(client: PrismaClient, userId: string, orderNumber: string): Promise<void> {
  const order = await client.order.findFirst({ where: { number: orderNumber, customer: { userId } }, select: { id: true, status: true } });
  if (!order) throw new AppError("NOT_FOUND", "Commande introuvable.");
  if (order.status !== "PENDING_CONFIRMATION") {
    throw new AppError("CONFLICT", "Cette commande est déjà confirmée : contactez-nous pour l'annuler.");
  }
  await client.$transaction(async (tx) => {
    const comment = "Annulée par le client";
    const result = await applyOrderTransition(tx, order.id, "CANCELLED", userId, comment, (current) => current.status === "PENDING_CONFIRMATION");
    if (!result) throw new AppError("CONFLICT", "Cette commande ne peut plus être annulée en ligne : contactez-nous.");
    await recordAudit(tx, { actorId: userId, action: "order.cancel_by_customer", entityType: "Order", entityId: order.id });
  });
}

/**
 * Annule les commandes non confirmées dont la réservation a expiré (D3) et libère leur stock.
 * À lancer régulièrement (pnpm orders:expire, tâche planifiée). Renvoie les numéros annulés.
 */
export async function expireStaleOrders(client: PrismaClient, now: Date = new Date()): Promise<string[]> {
  const stale = await client.order.findMany({
    where: { status: "PENDING_CONFIRMATION", reservedUntil: { lt: now } },
    select: { id: true },
    take: 500,
  });
  const expired: string[] = [];
  for (const { id } of stale) {
    const number = await client.$transaction(async (tx) => {
      const comment = "Réservation expirée sans confirmation";
      // Revérifié sous verrou : une commande confirmée entre-temps n'est jamais annulée.
      const result = await applyOrderTransition(tx, id, "CANCELLED", null, comment, (order) =>
        order.status === "PENDING_CONFIRMATION" && order.reservedUntil !== null && order.reservedUntil < now,
      );
      if (!result) return null;
      await notifyOrderCustomer(tx, id, ORDER_STATUS_LABELS.CANCELLED, comment);
      await recordAudit(tx, { actorId: null, action: "order.expire", entityType: "Order", entityId: id });
      return result.number;
    });
    if (number) {
      expired.push(number);
      await dispatchOrderNotifications(client, id);
    }
  }
  return expired;
}
