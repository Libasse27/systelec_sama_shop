import "server-only";
import { Prisma } from "@/generated/prisma/client";
import { assertPermission, type Actor } from "@/server/authz/service";
import type { Db } from "@/server/db/client";
import type { ReportPeriod } from "./period";

/** Écritures détaillées au plus dans un rapport (les totaux couvrent toujours toute la période). */
export const REPORT_ENTRY_LIMIT = 10_000;

export interface CashTotals {
  received: number;
  voided: number;
  refunded: number;
  net: number;
  count: number;
}

export type EntryKind = "Encaissement" | "Annulation" | "Remboursement";

export interface ReportEntry {
  createdAt: Date;
  receiptNumber: string;
  kind: EntryKind;
  /** « Commande CMD-… » ou « Intervention INT-… ». */
  document: string;
  amount: number;
  recordedBy: string;
  reason: string | null;
}

export interface FinancialReport {
  period: ReportPeriod;
  cash: CashTotals;
  /** Seul moyen existant : les espèces (aucun paiement électronique). */
  byMethod: { method: "CASH"; label: string; net: number }[];
  byCashier: (CashTotals & { name: string })[];
  byDay: (Omit<CashTotals, "count"> & { day: string })[];
  byDocument: { orders: number; interventions: number };
  /** Commandes remises au client sur la période. */
  sales: { count: number; total: number; deliveryFees: number; itemsSold: number };
  refunds: { receiptNumber: string; returnNumber: string; orderNumber: string; amount: number; createdAt: Date; recordedBy: string }[];
  invoicedInterventions: { count: number; total: number; rows: { invoiceNumber: string; interventionNumber: string; customerName: string; total: number; issuedAt: Date }[] };
  entries: ReportEntry[];
  /** Vrai si la période compte plus de lignes détaillées (écritures, remboursements ou factures) que la limite. */
  truncated: boolean;
}

interface TotalsRow {
  key: string;
  received: bigint;
  voided: bigint;
  refunded: bigint;
  count: bigint;
}

const toTotals = (row: Omit<TotalsRow, "key">): CashTotals => {
  const received = Number(row.received);
  const voided = Number(row.voided);
  const refunded = Number(row.refunded);
  return { received, voided, refunded, net: received - voided - refunded, count: Number(row.count) };
};

const TOTAL_COLUMNS = Prisma.sql`
  coalesce(sum("amount") FILTER (WHERE "amount" > 0), 0)::bigint AS received,
  coalesce(-sum("amount") FILTER (WHERE "amount" < 0 AND "returnId" IS NULL), 0)::bigint AS voided,
  coalesce(-sum("amount") FILTER (WHERE "returnId" IS NOT NULL), 0)::bigint AS refunded,
  count(*)::bigint AS count`;

/** Écritures de caisse groupées (jour à Dakar, agent, document) sur [from, to[. */
function groupedTotals(client: Db, period: ReportPeriod, key: Prisma.Sql): Promise<TotalsRow[]> {
  return client.$queryRaw<TotalsRow[]>`
    SELECT ${key} AS key, ${TOTAL_COLUMNS}
    FROM payments WHERE "createdAt" >= ${period.from} AND "createdAt" < ${period.to}
    GROUP BY 1 ORDER BY 1`;
}

const kindOf = (payment: { amount: number; returnId: string | null }): EntryKind =>
  payment.returnId ? "Remboursement" : payment.amount > 0 ? "Encaissement" : "Annulation";

/** Exige les droits d'un rapport financier : reports.read et payments.read (le stock seul ne suffit pas). */
export async function assertFinancialAccess(client: Db, actor: Actor): Promise<void> {
  await assertPermission(client, actor, "reports.read");
  await assertPermission(client, actor, "payments.read");
}

/**
 * Rapport financier d'une période : encaissements, annulations et remboursements (par jour, agent,
 * moyen, document), ventes remises au client, remboursements et interventions facturées.
 */
export async function getFinancialReport(client: Db, actor: Actor, period: ReportPeriod): Promise<FinancialReport> {
  await assertFinancialAccess(client, actor);
  const range = { gte: period.from, lt: period.to };
  const [all, byDay, byRecorder, byDocument, sales, itemsSold, refunds, invoices, invoiceTotals, payments] = await Promise.all([
    groupedTotals(client, period, Prisma.sql`'all'`),
    groupedTotals(client, period, Prisma.sql`to_char("createdAt" AT TIME ZONE 'Africa/Dakar', 'YYYY-MM-DD')`),
    groupedTotals(client, period, Prisma.sql`"recordedById"`),
    groupedTotals(client, period, Prisma.sql`CASE WHEN "orderId" IS NOT NULL THEN 'orders' ELSE 'interventions' END`),
    client.order.aggregate({ where: { status: "CLOSED", closedAt: range }, _count: true, _sum: { total: true, deliveryFee: true } }),
    client.orderItem.aggregate({ where: { order: { status: "CLOSED", closedAt: range } }, _sum: { quantity: true } }),
    client.payment.findMany({
      where: { createdAt: range, returnId: { not: null } },
      orderBy: [{ createdAt: "asc" }, { id: "asc" }],
      take: REPORT_ENTRY_LIMIT + 1,
      select: { receiptNumber: true, amount: true, createdAt: true, recordedBy: { select: { name: true } }, return: { select: { number: true } }, order: { select: { number: true } } },
    }),
    client.invoice.findMany({
      where: { issuedAt: range, interventionId: { not: null } },
      orderBy: [{ issuedAt: "asc" }, { id: "asc" }],
      take: REPORT_ENTRY_LIMIT + 1,
      select: { number: true, total: true, issuedAt: true, customer: true, intervention: { select: { number: true } } },
    }),
    client.invoice.aggregate({ where: { issuedAt: range, interventionId: { not: null } }, _count: true, _sum: { total: true } }),
    client.payment.findMany({
      where: { createdAt: range },
      orderBy: [{ createdAt: "asc" }, { id: "asc" }],
      take: REPORT_ENTRY_LIMIT + 1,
      select: {
        receiptNumber: true,
        amount: true,
        createdAt: true,
        reason: true,
        returnId: true,
        recordedBy: { select: { name: true } },
        order: { select: { number: true } },
        intervention: { select: { number: true } },
      },
    }),
  ]);
  const names = new Map(
    (await client.user.findMany({ where: { id: { in: byRecorder.map((row) => row.key) } }, select: { id: true, name: true } })).map((user) => [user.id, user.name]),
  );
  const cash = all[0] ? toTotals(all[0]) : { received: 0, voided: 0, refunded: 0, net: 0, count: 0 };
  const documentNet = (key: string) => {
    const row = byDocument.find((entry) => entry.key === key);
    return row ? toTotals(row).net : 0;
  };
  return {
    period,
    cash,
    byMethod: [{ method: "CASH", label: "Espèces", net: cash.net }],
    byCashier: byRecorder
      .map(({ key, ...row }) => ({ name: names.get(key) ?? "Inconnu", ...toTotals(row) }))
      .sort((a, b) => a.name.localeCompare(b.name, "fr")),
    byDay: byDay.map(({ key, ...row }) => {
      const { received, voided, refunded, net } = toTotals(row);
      return { day: key, received, voided, refunded, net };
    }),
    byDocument: { orders: documentNet("orders"), interventions: documentNet("interventions") },
    sales: { count: sales._count, total: sales._sum.total ?? 0, deliveryFees: sales._sum.deliveryFee ?? 0, itemsSold: itemsSold._sum.quantity ?? 0 },
    refunds: refunds.slice(0, REPORT_ENTRY_LIMIT).map((payment) => ({
      receiptNumber: payment.receiptNumber,
      returnNumber: payment.return?.number ?? "",
      orderNumber: payment.order?.number ?? "",
      amount: -payment.amount,
      createdAt: payment.createdAt,
      recordedBy: payment.recordedBy.name,
    })),
    invoicedInterventions: {
      count: invoiceTotals._count,
      total: invoiceTotals._sum.total ?? 0,
      rows: invoices.slice(0, REPORT_ENTRY_LIMIT).map((invoice) => ({
        invoiceNumber: invoice.number,
        interventionNumber: invoice.intervention?.number ?? "",
        customerName: (invoice.customer as { name?: string } | null)?.name ?? "",
        total: invoice.total,
        issuedAt: invoice.issuedAt,
      })),
    },
    entries: payments.slice(0, REPORT_ENTRY_LIMIT).map((payment) => ({
      createdAt: payment.createdAt,
      receiptNumber: payment.receiptNumber,
      kind: kindOf(payment),
      document: payment.order ? `Commande ${payment.order.number}` : `Intervention ${payment.intervention?.number ?? ""}`,
      amount: payment.amount,
      recordedBy: payment.recordedBy.name,
      reason: payment.reason,
    })),
    truncated: [payments, refunds, invoices].some((rows) => rows.length > REPORT_ENTRY_LIMIT),
  };
}
