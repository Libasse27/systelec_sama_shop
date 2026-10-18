import "server-only";
import type { Prisma, ReturnEventType, ReturnExceptionGround, ReturnStatus, ReturnVerificationKind } from "@/generated/prisma/client";
import type { BusinessHours } from "@/lib/business-hours";
import { assertPermission, type Actor } from "@/server/authz/service";
import type { Db } from "@/server/db/client";
import { logger } from "@/server/logger";
import { settingsDefaults } from "@/server/modules/settings/schemas";
import { getSetting } from "@/server/modules/settings/service";
import { isProcessingOverdue, OPEN_RETURN_STATUSES, processingDueAt } from "./policy";
import { maxRefundFor } from "./refund-cap";

export const RETURN_STATUSES: readonly ReturnStatus[] = ["RECEIVED", "VERIFICATION", "REFUND_PENDING", "COMPLETED", "REJECTED"];

/** Retours à traiter : à examiner, en vérification, ou remboursement à verser. */
export const RETURNS_TO_PROCESS: readonly ReturnStatus[] = [...OPEN_RETURN_STATUSES, "REFUND_PENDING"];

export function parseReturnStatus(value: unknown): ReturnStatus | undefined {
  return RETURN_STATUSES.find((status) => status === value);
}

/**
 * Heures ouvrables en vigueur. Une valeur illisible en base ne bloque ni les écrans ni la tâche
 * planifiée : repli sur la valeur par défaut, journalisé.
 */
export async function getBusinessHours(client: Db): Promise<BusinessHours> {
  try {
    return await getSetting("businessHours", client);
  } catch (error) {
    logger.error("Heures ouvrables illisibles : valeur par défaut utilisée", { error: error instanceof Error ? error.message : "inconnue" });
    return settingsDefaults.businessHours;
  }
}

/** Retour encore ouvert dont le traitement est en retard (alerte déjà envoyée, ou échéance passée sans action). */
function isOpenAndOverdue(
  row: { status: ReturnStatus; createdAt: Date; firstActionAt: Date | null; overdueNotifiedAt: Date | null },
  schedule: BusinessHours,
  now: Date,
): boolean {
  if (!(OPEN_RETURN_STATUSES as readonly ReturnStatus[]).includes(row.status) || row.firstActionAt !== null) return false;
  return row.overdueNotifiedAt !== null || isProcessingOverdue(row, schedule, now);
}

export interface ReturnEventView {
  id: string;
  type: ReturnEventType;
  fromStatus: ReturnStatus | null;
  toStatus: ReturnStatus;
  actorName: string | null;
  comment: string | null;
  verificationKind: ReturnVerificationKind | null;
  details: Prisma.JsonValue;
  createdAt: Date;
}

export interface ReturnView {
  id: string;
  orderId: string;
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
  createdById: string;
  createdBy: string | null;
  decidedBy: string | null;
  refundReceipt: string | null;
  /** Politique de retours (décision 2). */
  handedOverAt: Date;
  declarationDeadline: Date;
  lateDeclaration: boolean;
  exceptionGround: ReturnExceptionGround | null;
  exceptionNote: string | null;
  firstActionAt: Date | null;
  overdueNotifiedAt: Date | null;
  processingDueAt: Date;
  processingOverdue: boolean;
  /** Vérification en attente de réponse (statut « vérification demandée »). */
  pendingVerification: { kind: ReturnVerificationKind; request: string; requestedAt: Date; requestedBy: string | null } | null;
  items: { productName: string; variantName: string; sku: string; quantity: number; unitPrice: number }[];
  events: ReturnEventView[];
}

const RETURN_SELECT = {
  id: true,
  orderId: true,
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
  handedOverAt: true,
  declarationDeadline: true,
  lateDeclaration: true,
  exceptionGround: true,
  exceptionNote: true,
  firstActionAt: true,
  overdueNotifiedAt: true,
  refund: { select: { receiptNumber: true } },
  items: { orderBy: { id: "asc" }, select: { quantity: true, unitPrice: true, orderItem: { select: { productName: true, variantName: true, sku: true } } } },
  events: {
    orderBy: [{ createdAt: "asc" }, { id: "asc" }],
    select: { id: true, type: true, fromStatus: true, toStatus: true, actorId: true, comment: true, verificationKind: true, details: true, createdAt: true },
  },
} satisfies Prisma.ReturnSelect;

type ReturnRow = Prisma.ReturnGetPayload<{ select: typeof RETURN_SELECT }>;

async function toViews(client: Db, rows: ReturnRow[], order: { subtotal: number; discountTotal: number }, schedule: BusinessHours): Promise<ReturnView[]> {
  const ids = new Set<string>();
  for (const row of rows) {
    ids.add(row.createdById);
    if (row.decidedById) ids.add(row.decidedById);
    for (const event of row.events) if (event.actorId) ids.add(event.actorId);
  }
  const users = await client.user.findMany({ where: { id: { in: [...ids] } }, select: { id: true, name: true } });
  const names = new Map(users.map((user) => [user.id, user.name]));
  const now = new Date();
  return rows.map(({ decidedById, refund, items, events, ...row }) => {
    const eventViews = events.map(({ actorId, ...event }) => ({ ...event, actorName: actorId ? (names.get(actorId) ?? null) : null }));
    const lastRequest = [...eventViews].reverse().find((event) => event.type === "VERIFICATION_REQUESTED");
    return {
      ...row,
      createdBy: names.get(row.createdById) ?? null,
      decidedBy: decidedById ? (names.get(decidedById) ?? null) : null,
      refundReceipt: refund?.receiptNumber ?? null,
      maxRefund: maxRefundFor(row.itemsValue, order),
      processingDueAt: processingDueAt(row.createdAt, schedule),
      processingOverdue: isOpenAndOverdue(row, schedule, now),
      pendingVerification:
        row.status === "VERIFICATION" && lastRequest?.verificationKind
          ? { kind: lastRequest.verificationKind, request: lastRequest.comment ?? "", requestedAt: lastRequest.createdAt, requestedBy: lastRequest.actorName }
          : null,
      items: items.map(({ orderItem, ...item }) => ({ ...item, ...orderItem })),
      events: eventViews,
    };
  });
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
  const [rows, items, order, schedule] = await Promise.all([
    client.return.findMany({ where: { orderId }, orderBy: [{ createdAt: "asc" }, { id: "asc" }], select: RETURN_SELECT }),
    client.orderItem.findMany({
      where: { orderId },
      orderBy: { id: "asc" },
      select: { id: true, productName: true, variantName: true, sku: true, unitPrice: true, quantity: true, returnItems: { where: { return: { status: { not: "REJECTED" } } }, select: { quantity: true } } },
    }),
    client.order.findUnique({ where: { id: orderId }, select: { subtotal: true, discountTotal: true } }),
    getBusinessHours(client),
  ]);
  const returnable = items.map(({ id, quantity, returnItems, ...item }) => ({
    ...item,
    orderItemId: id,
    delivered: quantity,
    remaining: quantity - returnItems.reduce((sum, line) => sum + line.quantity, 0),
  }));
  return { returns: await toViews(client, rows, order ?? { subtotal: 0, discountTotal: 0 }, schedule), returnable };
}

/** Fiche d'un retour (orders.read) : détail, délais, vérification en attente, historique. */
export async function getReturn(client: Db, actor: Actor, returnId: string): Promise<(ReturnView & { orderNumber: string; customerName: string }) | null> {
  await assertPermission(client, actor, "orders.read");
  const row = await client.return.findUnique({
    where: { id: returnId },
    select: { ...RETURN_SELECT, order: { select: { number: true, subtotal: true, discountTotal: true, customer: { select: { name: true } } } } },
  });
  if (!row) return null;
  const { order, ...rest } = row;
  const [view] = await toViews(client, [rest], order, await getBusinessHours(client));
  return view ? { ...view, orderNumber: order.number, customerName: order.customer.name } : null;
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
  lateDeclaration: boolean;
  processingOverdue: boolean;
}

export const RETURNS_PAGE_SIZE = 30;

/**
 * Retours, à traiter d'abord : sans filtre de statut, ceux à examiner, en vérification ou à rembourser
 * (orders.read). Filtre « hors délai » (déclarés après 48 h).
 */
export async function listReturns(
  client: Db,
  actor: Actor,
  options: { status?: ReturnStatus; late?: boolean; page?: number } = {},
): Promise<{ rows: ReturnListRow[]; total: number; page: number; pageCount: number }> {
  await assertPermission(client, actor, "orders.read");
  const where: Prisma.ReturnWhereInput = {
    status: options.status ?? { in: [...RETURNS_TO_PROCESS] },
    ...(options.late && { lateDeclaration: true }),
  };
  const [total, schedule] = await Promise.all([client.return.count({ where }), getBusinessHours(client)]);
  const pageCount = Math.max(1, Math.ceil(total / RETURNS_PAGE_SIZE));
  const page = Math.min(Math.max(1, Math.trunc(options.page ?? 1)), pageCount);
  const rows = await client.return.findMany({
    where,
    orderBy: [{ createdAt: "desc" }, { id: "desc" }],
    skip: (page - 1) * RETURNS_PAGE_SIZE,
    take: RETURNS_PAGE_SIZE,
    select: {
      id: true,
      number: true,
      status: true,
      itemsValue: true,
      refundAmount: true,
      createdAt: true,
      lateDeclaration: true,
      firstActionAt: true,
      overdueNotifiedAt: true,
      order: { select: { id: true, number: true, customer: { select: { name: true } } } },
    },
  });
  const now = new Date();
  return {
    rows: rows.map(({ order, firstActionAt, overdueNotifiedAt, ...row }) => ({
      ...row,
      orderId: order.id,
      orderNumber: order.number,
      customerName: order.customer.name,
      processingOverdue: isOpenAndOverdue({ ...row, firstActionAt, overdueNotifiedAt }, schedule, now),
    })),
    total,
    page,
    pageCount,
  };
}
