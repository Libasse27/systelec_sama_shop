import "server-only";
import type { Prisma, ReturnStatus } from "@/generated/prisma/client";
import { assertPermission, type Actor } from "@/server/authz/service";
import { maxRefundFor } from "./refund-cap";
import type { Db } from "@/server/db/client";

export const RETURN_STATUSES: readonly ReturnStatus[] = ["RECEIVED", "REFUND_PENDING", "COMPLETED", "REJECTED"];

export function parseReturnStatus(value: unknown): ReturnStatus | undefined {
  return RETURN_STATUSES.find((status) => status === value);
}

export interface ReturnView {
  id: string;
  /** Remboursement maximal (valeur des articles, part de la remise déduite). */
  maxRefund: number;
  number: string;
  status: ReturnStatus;
  reason: string;
  itemsValue: number;
  refundAmount: number;
  restocked: boolean | null;
  decisionNote: string | null;
  createdAt: Date;
  decidedAt: Date | null;
  refundedAt: Date | null;
  createdBy: string | null;
  decidedBy: string | null;
  refundReceipt: string | null;
  items: { productName: string; variantName: string; sku: string; quantity: number; unitPrice: number }[];
}

const RETURN_SELECT = {
  id: true,
  number: true,
  status: true,
  reason: true,
  itemsValue: true,
  refundAmount: true,
  restocked: true,
  decisionNote: true,
  createdAt: true,
  decidedAt: true,
  refundedAt: true,
  createdById: true,
  decidedById: true,
  refund: { select: { receiptNumber: true } },
  items: { orderBy: { id: "asc" }, select: { quantity: true, unitPrice: true, orderItem: { select: { productName: true, variantName: true, sku: true } } } },
} satisfies Prisma.ReturnSelect;

type ReturnRow = Prisma.ReturnGetPayload<{ select: typeof RETURN_SELECT }>;

async function toViews(client: Db, rows: ReturnRow[], order: { subtotal: number; discountTotal: number }): Promise<ReturnView[]> {
  const ids = [...new Set(rows.flatMap((row) => [row.createdById, row.decidedById]).filter((id): id is string => id !== null))];
  const users = await client.user.findMany({ where: { id: { in: ids } }, select: { id: true, name: true } });
  const names = new Map(users.map((user) => [user.id, user.name]));
  return rows.map(({ createdById, decidedById, refund, items, ...row }) => ({
    ...row,
    createdBy: names.get(createdById) ?? null,
    decidedBy: decidedById ? (names.get(decidedById) ?? null) : null,
    refundReceipt: refund?.receiptNumber ?? null,
    maxRefund: maxRefundFor(row.itemsValue, order),
    items: items.map(({ orderItem, ...item }) => ({ ...item, ...orderItem })),
  }));
}

export interface ReturnableLine {
  orderItemId: string;
  productName: string;
  variantName: string;
  sku: string;
  unitPrice: number;
  delivered: number;
  /** Encore retournable (retours non refusés déduits). */
  remaining: number;
}

/** Retours d'une commande et quantités encore retournables (orders.read). */
export async function getOrderReturns(client: Db, actor: Actor, orderId: string): Promise<{ returns: ReturnView[]; returnable: ReturnableLine[] }> {
  await assertPermission(client, actor, "orders.read");
  const [rows, items, order] = await Promise.all([
    client.return.findMany({ where: { orderId }, orderBy: [{ createdAt: "asc" }, { id: "asc" }], select: RETURN_SELECT }),
    client.orderItem.findMany({
      where: { orderId },
      orderBy: { id: "asc" },
      select: { id: true, productName: true, variantName: true, sku: true, unitPrice: true, quantity: true, returnItems: { where: { return: { status: { not: "REJECTED" } } }, select: { quantity: true } } },
    }),
    client.order.findUnique({ where: { id: orderId }, select: { subtotal: true, discountTotal: true } }),
  ]);
  const returnable = items.map(({ id, quantity, returnItems, ...item }) => ({
    ...item,
    orderItemId: id,
    delivered: quantity,
    remaining: quantity - returnItems.reduce((sum, line) => sum + line.quantity, 0),
  }));
  return { returns: await toViews(client, rows, order ?? { subtotal: 0, discountTotal: 0 }), returnable };
}

export interface ReturnListRow {
  id: string;
  number: string;
  status: ReturnStatus;
  orderId: string;
  orderNumber: string;
  customerName: string;
  itemsValue: number;
  refundAmount: number;
  createdAt: Date;
}

export const RETURNS_PAGE_SIZE = 30;

/** Retours, à traiter d'abord : sans filtre, ceux à vérifier ou à rembourser (orders.read). */
export async function listReturns(
  client: Db,
  actor: Actor,
  options: { status?: ReturnStatus; page?: number } = {},
): Promise<{ rows: ReturnListRow[]; total: number; page: number; pageCount: number }> {
  await assertPermission(client, actor, "orders.read");
  const where: Prisma.ReturnWhereInput = { status: options.status ?? { in: ["RECEIVED", "REFUND_PENDING"] } };
  const total = await client.return.count({ where });
  const pageCount = Math.max(1, Math.ceil(total / RETURNS_PAGE_SIZE));
  const page = Math.min(Math.max(1, Math.trunc(options.page ?? 1)), pageCount);
  const rows = await client.return.findMany({
    where,
    orderBy: [{ createdAt: "desc" }, { id: "desc" }],
    skip: (page - 1) * RETURNS_PAGE_SIZE,
    take: RETURNS_PAGE_SIZE,
    select: { id: true, number: true, status: true, itemsValue: true, refundAmount: true, createdAt: true, order: { select: { id: true, number: true, customer: { select: { name: true } } } } },
  });
  return {
    rows: rows.map(({ order, ...row }) => ({ ...row, orderId: order.id, orderNumber: order.number, customerName: order.customer.name })),
    total,
    page,
    pageCount,
  };
}
