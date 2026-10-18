import "server-only";
import type { CourierKind, DeliveryStatus, OrderStatus, Prisma } from "@/generated/prisma/client";
import { assertPermission, type Actor } from "@/server/authz/service";
import type { Db } from "@/server/db/client";
import type { ShippingAddress } from "@/server/modules/orders/schemas";

export const DELIVERY_STATUSES: readonly DeliveryStatus[] = ["ASSIGNED", "IN_TRANSIT", "DELIVERED", "FAILED"];

/**
 * Livraisons qui restent à faire : assignées, en route ou en échec, sur une commande toujours
 * active (une commande annulée avant le départ ne mobilise plus de livreur).
 */
export const PENDING_DELIVERY_WHERE = {
  status: { in: ["ASSIGNED", "IN_TRANSIT", "FAILED"] },
  order: { status: { not: "CANCELLED" } },
} satisfies Prisma.DeliveryWhereInput;

export function parseDeliveryStatus(value: unknown): DeliveryStatus | undefined {
  return DELIVERY_STATUSES.find((status) => status === value);
}

export interface CourierRow {
  id: string;
  name: string;
  phone: string;
  /** Décision 5 : livreur interne (compte relié) ou transporteur externe (sans compte). */
  kind: CourierKind;
  userId: string | null;
  accountName: string | null;
  isActive: boolean;
  activeDeliveries: number;
}

/** Livreurs, actifs d'abord, avec leurs livraisons en cours (assignées ou en route). */
export async function listCouriers(client: Db, actor: Actor): Promise<CourierRow[]> {
  await assertPermission(client, actor, "deliveries.manage");
  const couriers = await client.courier.findMany({
    orderBy: [{ isActive: "desc" }, { name: "asc" }],
    select: {
      id: true,
      name: true,
      phone: true,
      kind: true,
      userId: true,
      user: { select: { name: true, email: true } },
      isActive: true,
      _count: { select: { deliveries: { where: { status: { in: ["ASSIGNED", "IN_TRANSIT"] }, order: { status: { not: "CANCELLED" } } } } } },
    },
  });
  return couriers.map(({ _count, user, ...courier }) => ({ ...courier, accountName: user ? `${user.name} (${user.email})` : null, activeDeliveries: _count.deliveries }));
}

/** Comptes reliables à un livreur interne : personnel actif portant le rôle « Livreur » (deliveries.manage). */
export async function listCourierAccounts(client: Db, actor: Actor): Promise<{ id: string; label: string }[]> {
  await assertPermission(client, actor, "deliveries.manage");
  const users = await client.user.findMany({
    where: { isActive: true, kind: "STAFF", roles: { some: { role: { code: "COURIER" } } } },
    orderBy: { name: "asc" },
    select: { id: true, name: true, email: true },
  });
  return users.map((user) => ({ id: user.id, label: `${user.name} (${user.email})` }));
}

export interface MyDeliveryRow {
  orderId: string;
  orderNumber: string;
  orderStatus: OrderStatus;
  status: DeliveryStatus;
  scheduledFor: Date | null;
  attempts: number;
  failureReason: string | null;
  customerName: string;
  customerPhone: string;
  address: string;
  /** Reste à encaisser à la livraison. */
  balance: number;
  items: { productName: string; variantName: string; quantity: number }[];
}

/** Livraisons terminées encore affichées au livreur (confirmation de sa tournée). */
const RECENT_DELIVERED_HOURS = 24;

/**
 * Livraisons du livreur connecté (deliveries.update_own, décision 5) : celles qui lui sont attribuées et
 * restent à faire, plus celles livrées depuis 24 h. Seulement ce qu'il faut pour livrer et encaisser :
 * client, téléphone, adresse, articles, reste à payer ; rien d'autre de la commande ni de la caisse.
 */
export async function listMyDeliveries(client: Db, actor: Actor, now: Date = new Date()): Promise<MyDeliveryRow[]> {
  await assertPermission(client, actor, "deliveries.update_own");
  const deliveries = await client.delivery.findMany({
    where: {
      courier: { userId: actor.id },
      OR: [PENDING_DELIVERY_WHERE, { status: "DELIVERED", deliveredAt: { gte: new Date(now.getTime() - RECENT_DELIVERED_HOURS * 3_600_000) } }],
    },
    orderBy: [{ scheduledFor: { sort: "asc", nulls: "last" } }, { updatedAt: "asc" }],
    take: 100,
    select: {
      status: true,
      scheduledFor: true,
      attempts: true,
      failureReason: true,
      order: {
        select: {
          id: true,
          number: true,
          status: true,
          total: true,
          amountPaid: true,
          shippingAddress: true,
          customer: { select: { name: true, phone: true } },
          items: { orderBy: { id: "asc" }, select: { productName: true, variantName: true, quantity: true } },
        },
      },
    },
  });
  return deliveries.map(({ order, ...delivery }) => ({
    ...delivery,
    orderId: order.id,
    orderNumber: order.number,
    orderStatus: order.status,
    customerName: order.customer.name,
    customerPhone: order.customer.phone,
    address: addressText(order.shippingAddress as unknown as ShippingAddress | null),
    balance: Math.max(0, order.total - order.amountPaid),
    items: order.items,
  }));
}

export interface DeliveryRow {
  orderId: string;
  orderNumber: string;
  orderStatus: OrderStatus;
  status: DeliveryStatus;
  courierName: string;
  customerName: string;
  customerPhone: string;
  address: string;
  scheduledFor: Date | null;
  attempts: number;
  failureReason: string | null;
  updatedAt: Date;
}

export const DELIVERIES_PAGE_SIZE = 30;

const addressText = (address: ShippingAddress | null): string =>
  address ? [address.line1, address.district, address.city].filter(Boolean).join(", ") + (address.landmark ? ` (${address.landmark})` : "") : "";

/**
 * Livraisons (deliveries.manage), filtrées par statut ou livreur. Sans filtre de statut :
 * seulement celles qui restent à faire (voir PENDING_DELIVERY_WHERE).
 */
export async function listDeliveries(
  client: Db,
  actor: Actor,
  options: { status?: DeliveryStatus; courierId?: string; page?: number } = {},
): Promise<{ rows: DeliveryRow[]; total: number; page: number; pageCount: number }> {
  await assertPermission(client, actor, "deliveries.manage");
  const where: Prisma.DeliveryWhereInput = {
    ...(options.status ? { status: options.status } : PENDING_DELIVERY_WHERE),
    ...(options.courierId ? { courierId: options.courierId } : {}),
  };
  const total = await client.delivery.count({ where });
  const pageCount = Math.max(1, Math.ceil(total / DELIVERIES_PAGE_SIZE));
  const page = Math.min(Math.max(1, Math.trunc(options.page ?? 1)), pageCount);
  const deliveries = await client.delivery.findMany({
    where,
    orderBy: [{ updatedAt: "desc" }, { id: "desc" }],
    skip: (page - 1) * DELIVERIES_PAGE_SIZE,
    take: DELIVERIES_PAGE_SIZE,
    select: {
      status: true,
      scheduledFor: true,
      attempts: true,
      failureReason: true,
      updatedAt: true,
      courier: { select: { name: true } },
      order: { select: { id: true, number: true, status: true, shippingAddress: true, customer: { select: { name: true, phone: true } } } },
    },
  });
  const rows = deliveries.map(({ courier, order, ...delivery }) => ({
    ...delivery,
    orderId: order.id,
    orderNumber: order.number,
    orderStatus: order.status,
    courierName: courier.name,
    customerName: order.customer.name,
    customerPhone: order.customer.phone,
    address: addressText(order.shippingAddress as unknown as ShippingAddress | null),
  }));
  return { rows, total, page, pageCount };
}

export interface OrderDelivery {
  status: DeliveryStatus;
  courier: { id: string; name: string; phone: string };
  attempts: number;
  scheduledFor: Date | null;
  startedAt: Date | null;
  deliveredAt: Date | null;
  recipientName: string | null;
  proofNote: string | null;
  failureReason: string | null;
}

/** Livraison d'une commande (lecture : orders.read ou deliveries.manage). */
export async function getOrderDelivery(client: Db, actor: Actor, orderId: string): Promise<OrderDelivery | null> {
  await assertPermission(client, actor, actor.permissions.has("deliveries.manage") ? "deliveries.manage" : "orders.read");
  const delivery = await client.delivery.findUnique({
    where: { orderId },
    select: {
      status: true,
      attempts: true,
      scheduledFor: true,
      startedAt: true,
      deliveredAt: true,
      recipientName: true,
      proofNote: true,
      failureReason: true,
      courier: { select: { id: true, name: true, phone: true } },
    },
  });
  return delivery;
}
