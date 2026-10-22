import "server-only";
import type { DeliveryStatus, FulfillmentMethod, OrderHistoryField, OrderStatus, PaymentStatus, Prisma } from "@/generated/prisma/client";
import { assertPermission, type Actor } from "@/server/authz/service";
import type { Db } from "@/server/db/client";
import { verifyAccessToken, type AccessScope } from "./access-token";
import type { Contact, ShippingAddress } from "./schemas";
import { allowedTransitions } from "./status";
import { safeNotificationErrorCode } from "@/lib/labels";

// ─── Options de commande ─────────────────────────────────────────────────────

export interface CheckoutOptions {
  zones: { id: string; name: string; description: string | null; fee: number; freeAbove: number | null; leadTimeText: string | null }[];
  pickupPoints: { id: string; name: string; address: string; hours: string | null; phone: string | null }[];
}

/** Zones et points de retrait ACTIFS. Sans point de retrait, l'option est masquée (D4). */
export async function getCheckoutOptions(client: Db): Promise<CheckoutOptions> {
  const [zones, pickupPoints] = await Promise.all([
    client.deliveryZone.findMany({
      where: { isActive: true },
      orderBy: [{ position: "asc" }, { name: "asc" }],
      select: { id: true, name: true, description: true, fee: true, freeAbove: true, leadTimeText: true },
    }),
    client.pickupPoint.findMany({
      where: { isActive: true },
      orderBy: { name: "asc" },
      select: { id: true, name: true, address: true, hours: true, phone: true },
    }),
  ]);
  return { zones, pickupPoints };
}

/** Durée de validité du lien de suivi d'une commande invitée. */
export const GUEST_LINK_DAYS = 180;

// ─── Vue client ──────────────────────────────────────────────────────────────

export interface OrderView {
  id: string;
  number: string;
  status: OrderStatus;
  paymentStatus: PaymentStatus;
  fulfillmentMethod: FulfillmentMethod;
  contact: Contact;
  shippingAddress: ShippingAddress | null;
  deliveryZone: { name: string; leadTimeText: string | null } | null;
  pickupPoint: { name: string; address: string; hours: string | null; phone: string | null } | null;
  items: { sku: string; productName: string; variantName: string; unitPrice: number; quantity: number; lineTotal: number }[];
  subtotal: number;
  deliveryFee: number;
  discountTotal: number;
  total: number;
  /** Net des remboursements : le client a réglé amountPaid + refundedAmount. */
  amountPaid: number;
  refundedAmount: number;
  notes: string | null;
  createdAt: Date;
  history: { to: string; comment: string | null; createdAt: Date }[];
  /** Reçus (montant négatif = annulation d'un encaissement, ou remboursement d'un retour). */
  payments: { receiptNumber: string; amount: number; createdAt: Date; isRefund: boolean }[];
  invoiceNumber: string | null;
  deliveryStatus: DeliveryStatus | null;
}

/** Sélection explicite : ni prix d'achat, ni notes internes, ni auteurs des changements. */
const ORDER_VIEW_SELECT = {
  id: true,
  number: true,
  status: true,
  paymentStatus: true,
  fulfillmentMethod: true,
  contact: true,
  shippingAddress: true,
  deliveryZone: { select: { name: true, leadTimeText: true } },
  pickupPoint: { select: { name: true, address: true, hours: true, phone: true } },
  items: { orderBy: { id: "asc" }, select: { sku: true, productName: true, variantName: true, unitPrice: true, quantity: true, lineTotal: true } },
  subtotal: true,
  deliveryFee: true,
  discountTotal: true,
  total: true,
  amountPaid: true,
  refundedAmount: true,
  notes: true,
  createdAt: true,
  history: { where: { field: "ORDER" }, orderBy: { createdAt: "asc" }, select: { to: true, comment: true, createdAt: true } },
  payments: { orderBy: [{ createdAt: "asc" }, { id: "asc" }], select: { receiptNumber: true, amount: true, createdAt: true, returnId: true } },
  invoice: { select: { number: true } },
  delivery: { select: { status: true } },
} satisfies Prisma.OrderSelect;

type OrderRow = Prisma.OrderGetPayload<{ select: typeof ORDER_VIEW_SELECT }>;

const toView = ({ invoice, delivery, payments, ...order }: OrderRow): OrderView => ({
  ...order,
  contact: order.contact as unknown as Contact,
  shippingAddress: order.shippingAddress as unknown as ShippingAddress | null,
  payments: payments.map(({ returnId, ...payment }) => ({ ...payment, isRefund: returnId !== null })),
  invoiceNumber: invoice?.number ?? null,
  deliveryStatus: delivery?.status ?? null,
});

/** Commande d'un compte (jamais celle d'un autre client). */
export async function getCustomerOrder(client: Db, userId: string, number: string): Promise<OrderView | null> {
  const order = await client.order.findFirst({ where: { number, customer: { userId } }, select: ORDER_VIEW_SELECT });
  return order && toView(order);
}

/**
 * Lien de suivi invité valide : jeton signé de CETTE commande, et lien encore actif
 * (il expose des coordonnées : il ne reste pas valable indéfiniment).
 */
export function guestLinkAllows(order: { id: string; createdAt: Date }, token: string | undefined, scope: AccessScope = "order"): boolean {
  if (!verifyAccessToken(scope, order.id, token)) return false;
  return Date.now() - order.createdAt.getTime() <= GUEST_LINK_DAYS * 24 * 3600 * 1000;
}

/** Commande invitée, accessible uniquement avec le jeton du lien de suivi. */
export async function getGuestOrder(client: Db, number: string, token: string | undefined): Promise<OrderView | null> {
  const order = await client.order.findFirst({ where: { number, customer: { userId: null } }, select: ORDER_VIEW_SELECT });
  return order && guestLinkAllows(order, token) ? toView(order) : null;
}

export interface OrderSummary {
  number: string;
  status: OrderStatus;
  total: number;
  itemCount: number;
  createdAt: Date;
}

/** Historique des commandes d'un compte, la plus récente d'abord. */
export async function listCustomerOrders(client: Db, userId: string): Promise<OrderSummary[]> {
  const orders = await client.order.findMany({
    where: { customer: { userId } },
    orderBy: { createdAt: "desc" },
    take: 100,
    select: { number: true, status: true, total: true, createdAt: true, items: { select: { quantity: true } } },
  });
  return orders.map(({ items, ...order }) => ({ ...order, itemCount: items.reduce((sum, item) => sum + item.quantity, 0) }));
}

// ─── Administration ──────────────────────────────────────────────────────────

export const ADMIN_ORDERS_PAGE_SIZE = 30;
const ORDER_STATUSES = Object.keys({
  PENDING_CONFIRMATION: 1,
  CONFIRMED: 1,
  PREPARING: 1,
  READY_FOR_PICKUP: 1,
  READY_TO_SHIP: 1,
  CANCELLED: 1,
  CLOSED: 1,
} satisfies Record<OrderStatus, 1>) as OrderStatus[];

export function parseOrderStatus(value: unknown): OrderStatus | undefined {
  return ORDER_STATUSES.find((status) => status === value);
}

const PAYMENT_STATUSES = Object.keys({
  UNPAID: 1,
  PARTIALLY_PAID: 1,
  PAID: 1,
  TO_VERIFY: 1,
  REFUND_PENDING: 1,
  REFUNDED: 1,
} satisfies Record<PaymentStatus, 1>) as PaymentStatus[];

export function parsePaymentStatus(value: unknown): PaymentStatus | undefined {
  return PAYMENT_STATUSES.find((status) => status === value);
}

export interface AdminOrderRow {
  id: string;
  number: string;
  status: OrderStatus;
  paymentStatus: PaymentStatus;
  fulfillmentMethod: FulfillmentMethod;
  customerName: string;
  customerPhone: string;
  total: number;
  createdAt: Date;
  reservedUntil: Date | null;
}

export async function listAdminOrders(
  client: Db,
  actor: Actor,
  options: { status?: OrderStatus; paymentStatus?: PaymentStatus; q?: string; page?: number } = {},
): Promise<{ rows: AdminOrderRow[]; total: number; page: number; pageCount: number }> {
  await assertPermission(client, actor, "orders.read");
  const q = options.q?.trim().slice(0, 100);
  const where: Prisma.OrderWhereInput = {
    ...(options.status ? { status: options.status } : {}),
    ...(options.paymentStatus ? { paymentStatus: options.paymentStatus } : {}),
    ...(q
      ? {
          OR: [
            { number: { contains: q, mode: "insensitive" } },
            { customer: { name: { contains: q, mode: "insensitive" } } },
            { customer: { phone: { contains: q } } },
          ],
        }
      : {}),
  };
  const total = await client.order.count({ where });
  const pageCount = Math.max(1, Math.ceil(total / ADMIN_ORDERS_PAGE_SIZE));
  const page = Math.min(Math.max(1, Math.trunc(options.page ?? 1)), pageCount);
  const orders = await client.order.findMany({
    where,
    orderBy: [{ createdAt: "desc" }, { id: "desc" }],
    skip: (page - 1) * ADMIN_ORDERS_PAGE_SIZE,
    take: ADMIN_ORDERS_PAGE_SIZE,
    select: {
      id: true,
      number: true,
      status: true,
      paymentStatus: true,
      fulfillmentMethod: true,
      total: true,
      createdAt: true,
      reservedUntil: true,
      customer: { select: { name: true, phone: true } },
    },
  });
  const rows = orders.map(({ customer, ...order }) => ({ ...order, customerName: customer.name, customerPhone: customer.phone }));
  return { rows, total, page, pageCount };
}

export interface AdminOrder extends Omit<OrderView, "history"> {
  customer: { id: string; name: string; phone: string; email: string | null; hasAccount: boolean };
  internalNotes: string | null;
  reservedUntil: Date | null;
  nextStatuses: OrderStatus[];
  history: { field: OrderHistoryField; from: string | null; to: string; comment: string | null; createdAt: Date; actorName: string | null }[];
  notifications: { channel: string; template: string; recipient: string; status: string; attempts: number; nextAttemptAt: Date | null; error: string | null; createdAt: Date }[];
}

export async function getAdminOrder(client: Db, actor: Actor, id: string): Promise<AdminOrder | null> {
  await assertPermission(client, actor, "orders.read");
  const order = await client.order.findUnique({
    where: { id },
    select: {
      ...ORDER_VIEW_SELECT,
      internalNotes: true,
      reservedUntil: true,
      customer: { select: { id: true, name: true, phone: true, email: true, userId: true } },
      history: { orderBy: { createdAt: "asc" }, select: { field: true, from: true, to: true, comment: true, createdAt: true, actorId: true } },
    },
  });
  if (!order) return null;
  const actorIds = [...new Set(order.history.map((entry) => entry.actorId).filter((value): value is string => value !== null))];
  const [actors, notifications] = await Promise.all([
    client.user.findMany({ where: { id: { in: actorIds } }, select: { id: true, name: true } }),
    client.notification.findMany({
      where: { orderId: id },
      orderBy: { createdAt: "asc" },
      select: { channel: true, template: true, recipient: true, status: true, attempts: true, nextAttemptAt: true, error: true, createdAt: true },
    }),
  ]);
  const names = new Map(actors.map((user) => [user.id, user.name]));
  const { customer, history, ...rest } = order;
  return {
    ...toView({ ...rest, history: [] }),
    customer: { id: customer.id, name: customer.name, phone: customer.phone, email: customer.email, hasAccount: customer.userId !== null },
    internalNotes: rest.internalNotes,
    reservedUntil: rest.reservedUntil,
    nextStatuses: allowedTransitions(order.status, order.fulfillmentMethod),
    history: history.map(({ actorId, ...entry }) => ({ ...entry, actorName: actorId ? (names.get(actorId) ?? null) : null })),
    notifications: notifications.map((notification) => ({ ...notification, error: safeNotificationErrorCode(notification.error) })),
  };
}
