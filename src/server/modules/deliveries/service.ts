import "server-only";
import { z } from "zod";
import { Prisma, type DeliveryStatus, type OrderStatus, type PrismaClient } from "@/generated/prisma/client";
import { businessDayRange } from "@/lib/dates";
import { DELIVERY_STATUS_LABELS, ORDER_STATUS_LABELS } from "@/lib/labels";
import { optionalText } from "@/lib/schema-text";
import { recordAudit } from "@/server/audit/audit";
import { assertPermission, type Actor } from "@/server/authz/service";
import { AppError } from "@/server/errors";
import { lockOrderRow } from "@/server/modules/orders/lock";
import { applyOrderTransition, notifyOrderCustomer } from "@/server/modules/orders/status";
import { dispatchOrderNotifications } from "@/server/notifications/order-notifications";
import { parseInput } from "@/server/validation";

type Tx = Prisma.TransactionClient;

// ─── Livreurs ────────────────────────────────────────────────────────────────

export const courierSchema = z.object({
  name: z.string().trim().min(2).max(120),
  phone: z.string().trim().min(6, "Téléphone requis").max(30),
  isActive: z.boolean().default(true),
});

/** Crée (id absent) ou modifie un livreur (deliveries.manage). Un livreur désactivé garde ses livraisons passées. */
export async function saveCourier(client: PrismaClient, actor: Actor, id: string | null, input: unknown): Promise<{ id: string }> {
  await assertPermission(client, actor, "deliveries.manage");
  const data = parseInput(courierSchema, input, "Livreur");
  try {
    return await client.$transaction(async (tx) => {
      const before = id ? await tx.courier.findUnique({ where: { id }, select: { name: true, phone: true, isActive: true } }) : null;
      if (id && !before) throw new AppError("NOT_FOUND", "Livreur introuvable.");
      const saved = id ? await tx.courier.update({ where: { id }, data }) : await tx.courier.create({ data });
      await recordAudit(tx, { actorId: actor.id, action: id ? "courier.update" : "courier.create", entityType: "Courier", entityId: saved.id, before, after: data });
      return { id: saved.id };
    });
  } catch (error) {
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002") throw new AppError("CONFLICT", "Ce nom de livreur est déjà utilisé.");
    throw error;
  }
}

// ─── Cycle d'une livraison ───────────────────────────────────────────────────

/** Statuts de commande où l'on peut assigner un livreur (avant la remise). */
const ASSIGNABLE_ORDER_STATUSES: readonly OrderStatus[] = ["CONFIRMED", "PREPARING", "READY_TO_SHIP"];

const assignSchema = z.object({
  courierId: z.string().min(1, "Choisissez un livreur"),
  scheduledFor: z
    .string()
    .trim()
    .optional()
    .nullable()
    .transform((value, ctx) => {
      if (!value) return null;
      const range = businessDayRange(value);
      if (!range) {
        ctx.addIssue({ code: "custom", message: "Date invalide" });
        return z.NEVER;
      }
      return range.from;
    }),
  note: optionalText(300),
});

const completeSchema = z.object({
  recipientName: z.string().trim().min(2, "Indiquez qui a reçu la commande").max(120),
  proofNote: optionalText(500),
});

const failSchema = z.object({ reason: z.string().trim().min(3, "Indiquez le motif de l'échec").max(500) });

interface LockedDelivery {
  orderNumber: string;
  orderStatus: OrderStatus;
  fulfillmentMethod: "DELIVERY" | "PICKUP";
  delivery: { id: string; status: DeliveryStatus; courierId: string; attempts: number } | null;
}

/** Verrou de la commande EN PREMIER (même ordre que statuts et encaissements), puis lecture de sa livraison. */
async function lockDelivery(tx: Tx, orderId: string): Promise<LockedDelivery> {
  await lockOrderRow(tx, orderId);
  const order = await tx.order.findUniqueOrThrow({
    where: { id: orderId },
    select: { number: true, status: true, fulfillmentMethod: true, delivery: { select: { id: true, status: true, courierId: true, attempts: true } } },
  });
  return { orderNumber: order.number, orderStatus: order.status, fulfillmentMethod: order.fulfillmentMethod, delivery: order.delivery };
}

async function recordStep(
  tx: Tx,
  actor: Actor,
  orderId: string,
  from: DeliveryStatus | null,
  to: DeliveryStatus,
  comment: string | null,
  notify: boolean,
): Promise<void> {
  await tx.orderStatusHistory.create({ data: { orderId, field: "DELIVERY", from, to, actorId: actor.id, comment } });
  if (notify) await notifyOrderCustomer(tx, orderId, DELIVERY_STATUS_LABELS[to], comment);
  await recordAudit(tx, { actorId: actor.id, action: `delivery.${to.toLowerCase()}`, entityType: "Order", entityId: orderId, before: { status: from }, after: { status: to, comment } });
}

/** Exécute une étape sous verrou, puis envoie les notifications validées. */
async function step(client: PrismaClient, actor: Actor, orderId: string, run: (tx: Tx, locked: LockedDelivery) => Promise<void>): Promise<void> {
  await assertPermission(client, actor, "deliveries.manage");
  await client.$transaction(async (tx) => {
    const locked = await lockDelivery(tx, orderId);
    if (locked.fulfillmentMethod !== "DELIVERY") throw new AppError("CONFLICT", "Cette commande est à retirer en boutique : pas de livraison.");
    await run(tx, locked);
  });
  await dispatchOrderNotifications(client, orderId);
}

/**
 * Assigne (ou réassigne) un livreur actif à une commande à livrer, avant son départ.
 * Après un échec, la livraison repart d'un nouveau livreur ou du même.
 */
export async function assignCourier(client: PrismaClient, actor: Actor, orderId: string, input: unknown): Promise<void> {
  const { courierId, scheduledFor, note } = parseInput(assignSchema, input, "Livraison");
  await step(client, actor, orderId, async (tx, { orderStatus, delivery }) => {
    if (!ASSIGNABLE_ORDER_STATUSES.includes(orderStatus)) {
      throw new AppError("CONFLICT", `Commande « ${ORDER_STATUS_LABELS[orderStatus]} » : plus de livreur à assigner.`);
    }
    if (delivery && (delivery.status === "IN_TRANSIT" || delivery.status === "DELIVERED")) {
      throw new AppError("CONFLICT", "Le livreur est déjà parti : enregistrez d'abord le résultat de la livraison.");
    }
    const courier = await tx.courier.findUnique({ where: { id: courierId }, select: { name: true, isActive: true } });
    if (!courier?.isActive) throw new AppError("CONFLICT", "Livreur introuvable ou désactivé.");
    const data = { courierId, scheduledFor, status: "ASSIGNED" as const, failureReason: null };
    if (delivery) await tx.delivery.update({ where: { id: delivery.id }, data });
    else await tx.delivery.create({ data: { orderId, ...data } });
    const comment = [`Livreur : ${courier.name}`, note].filter(Boolean).join(" — ");
    await recordStep(tx, actor, orderId, delivery?.status ?? null, "ASSIGNED", comment, false);
  });
}

/** Départ du livreur : commande prête à livrer, livreur assigné (ou nouvelle tentative après un échec). */
export async function startDelivery(client: PrismaClient, actor: Actor, orderId: string): Promise<void> {
  await step(client, actor, orderId, async (tx, { orderStatus, delivery }) => {
    if (!delivery || (delivery.status !== "ASSIGNED" && delivery.status !== "FAILED")) {
      throw new AppError("CONFLICT", "Assignez d'abord un livreur.");
    }
    if (orderStatus !== "READY_TO_SHIP") throw new AppError("CONFLICT", "La commande doit être « Prête à livrer » avant le départ.");
    await tx.delivery.update({ where: { id: delivery.id }, data: { status: "IN_TRANSIT", startedAt: new Date(), attempts: delivery.attempts + 1 } });
    await recordStep(tx, actor, orderId, delivery.status, "IN_TRANSIT", `Tentative n° ${delivery.attempts + 1}`, true);
  });
}

/**
 * Livraison effectuée, avec sa preuve (nom de la personne qui a reçu, observations) : la commande
 * est remise au client dans la même transaction (stock sorti). Elle doit être soldée : le livreur
 * encaisse d'abord les espèces (payments.record).
 */
export async function completeDelivery(client: PrismaClient, actor: Actor, orderId: string, input: unknown): Promise<void> {
  const { recipientName, proofNote } = parseInput(completeSchema, input, "Preuve de livraison");
  await step(client, actor, orderId, async (tx, { delivery }) => {
    if (delivery?.status !== "IN_TRANSIT") throw new AppError("CONFLICT", "Seule une livraison en cours peut être marquée livrée.");
    // Message client : le nom de la personne qui a reçu. Les observations restent internes.
    const comment = `Reçue par ${recipientName}`;
    // Clôture d'abord : elle refuse une commande non soldée, et rien n'est alors modifié.
    const closed = await applyOrderTransition(tx, orderId, "CLOSED", actor.id, comment, undefined, true);
    if (!closed) throw new AppError("CONFLICT", "La commande ne peut pas être remise au client.");
    await tx.delivery.update({ where: { id: delivery.id }, data: { status: "DELIVERED", deliveredAt: new Date(), recipientName, proofNote, failureReason: null } });
    // Observations conservées sur la livraison (vue du personnel seulement).
    await recordStep(tx, actor, orderId, "IN_TRANSIT", "DELIVERED", comment, true);
  });
}

/** Échec d'une tentative, avec motif : la commande attend une nouvelle tentative (ou son annulation). */
export async function failDelivery(client: PrismaClient, actor: Actor, orderId: string, input: unknown): Promise<void> {
  const { reason } = parseInput(failSchema, input, "Échec de livraison");
  await step(client, actor, orderId, async (tx, { delivery }) => {
    if (delivery?.status !== "IN_TRANSIT") throw new AppError("CONFLICT", "Seule une livraison en cours peut échouer.");
    await tx.delivery.update({ where: { id: delivery.id }, data: { status: "FAILED", failureReason: reason } });
    await recordStep(tx, actor, orderId, "IN_TRANSIT", "FAILED", reason, true);
  });
}
