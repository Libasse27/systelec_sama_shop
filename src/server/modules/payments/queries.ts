import "server-only";
import type { Prisma } from "@/generated/prisma/client";
import { assertPermission, type Actor } from "@/server/authz/service";
import type { Db } from "@/server/db/client";
import { guestLinkAllows } from "@/server/modules/orders/queries";
import type { Contact } from "@/server/modules/orders/schemas";
import { getSetting } from "@/server/modules/settings/service";

// ─── Encaissements d'une commande (administration) ───────────────────────────

export interface AdminPaymentRow {
  id: string;
  receiptNumber: string;
  amount: number;
  balanceAfter: number;
  createdAt: Date;
  recordedBy: string;
  note: string | null;
  reason: string | null;
  /** Reçu annulé par cette contre-écriture. */
  reverses: string | null;
  /** Contre-écriture qui annule cet encaissement. */
  reversedBy: string | null;
}

const ADMIN_PAYMENT_SELECT = {
  id: true,
  receiptNumber: true,
  amount: true,
  balanceAfter: true,
  createdAt: true,
  note: true,
  reason: true,
  recordedBy: { select: { name: true } },
  reverses: { select: { receiptNumber: true } },
  reversedBy: { select: { receiptNumber: true } },
} satisfies Prisma.PaymentSelect;

const toAdminRow = ({ recordedBy, reverses, reversedBy, ...payment }: Prisma.PaymentGetPayload<{ select: typeof ADMIN_PAYMENT_SELECT }>) => ({
  ...payment,
  recordedBy: recordedBy.name,
  reverses: reverses?.receiptNumber ?? null,
  reversedBy: reversedBy?.receiptNumber ?? null,
});

/** Encaissements d'une commande : visibles avec payments.read, ou payments.record (le caissier voit ce qu'il saisit). */
export async function listOrderPayments(client: Db, actor: Actor, orderId: string): Promise<AdminPaymentRow[]> {
  const permission = actor.permissions.has("payments.read") ? "payments.read" : "payments.record";
  await assertPermission(client, actor, permission);
  const payments = await client.payment.findMany({
    where: { orderId },
    orderBy: [{ createdAt: "asc" }, { id: "asc" }],
    select: ADMIN_PAYMENT_SELECT,
  });
  return payments.map(toAdminRow);
}

// ─── Journal de caisse ───────────────────────────────────────────────────────

export const JOURNAL_LIMIT = 500;

export interface JournalRow extends AdminPaymentRow {
  orderId: string;
  orderNumber: string;
}

export interface PaymentJournal {
  rows: JournalRow[];
  /** Vrai si la journée compte plus de lignes que la limite affichée (les totaux restent complets). */
  truncated: boolean;
  totals: { received: number; voided: number; net: number; count: number };
  /** Net encaissé par agent : ce que chacun doit remettre en caisse. */
  byRecorder: { name: string; net: number; count: number }[];
}

/** Encaissements et contre-écritures d'une période [from, to[ (journée de caisse). */
export async function getPaymentJournal(client: Db, actor: Actor, range: { from: Date; to: Date }): Promise<PaymentJournal> {
  await assertPermission(client, actor, "payments.read");
  const where: Prisma.PaymentWhereInput = { createdAt: { gte: range.from, lt: range.to } };
  const [payments, received, voided, perRecorder] = await Promise.all([
    client.payment.findMany({
      where,
      orderBy: [{ createdAt: "desc" }, { id: "desc" }],
      take: JOURNAL_LIMIT + 1,
      select: { ...ADMIN_PAYMENT_SELECT, order: { select: { id: true, number: true } } },
    }),
    client.payment.aggregate({ where: { ...where, amount: { gt: 0 } }, _sum: { amount: true }, _count: true }),
    client.payment.aggregate({ where: { ...where, amount: { lt: 0 } }, _sum: { amount: true }, _count: true }),
    client.payment.groupBy({ by: ["recordedById"], where, _sum: { amount: true }, _count: true }),
  ]);
  const recorders = await client.user.findMany({ where: { id: { in: perRecorder.map((row) => row.recordedById) } }, select: { id: true, name: true } });
  const names = new Map(recorders.map((user) => [user.id, user.name]));
  const receivedTotal = received._sum.amount ?? 0;
  const voidedTotal = -(voided._sum.amount ?? 0);
  return {
    rows: payments.slice(0, JOURNAL_LIMIT).map(({ order, ...payment }) => ({ ...toAdminRow(payment), orderId: order.id, orderNumber: order.number })),
    truncated: payments.length > JOURNAL_LIMIT,
    totals: { received: receivedTotal, voided: voidedTotal, net: receivedTotal - voidedTotal, count: received._count + voided._count },
    byRecorder: perRecorder
      .map((row) => ({ name: names.get(row.recordedById) ?? "Inconnu", net: row._sum.amount ?? 0, count: row._count }))
      .sort((a, b) => a.name.localeCompare(b.name, "fr")),
  };
}

// ─── Reçu ────────────────────────────────────────────────────────────────────

export interface ReceiptData {
  receiptNumber: string;
  createdAt: Date;
  amount: number;
  balanceAfter: number;
  orderNumber: string;
  orderTotal: number;
  customer: { name: string; phone: string };
  recordedBy: string;
  /** Contre-écriture : le reçu annulé et le motif. */
  reversal: { receiptNumber: string; reason: string } | null;
  /** Encaissement annulé depuis (mention sur le reçu d'origine). */
  voidedBy: string | null;
  company: { name: string; address: string | null; phone: string | null; email: string | null; ninea: string | null; rccm: string | null };
}

export interface ReceiptViewer {
  /** Utilisateur connecté (personnel ou client), ou null. */
  user: Actor | null;
  /** Jeton du lien de suivi d'une commande invitée. */
  token?: string;
}

/**
 * Reçu, pour qui a le droit de le voir : le personnel des encaissements, le titulaire du
 * compte de la commande, ou l'invité muni du lien de suivi de la commande. Sinon null
 * (la page répond 404, sans dire si le reçu existe). La note interne n'est jamais incluse.
 */
export async function getReceipt(client: Db, viewer: ReceiptViewer, receiptNumber: string): Promise<ReceiptData | null> {
  const payment = await client.payment.findUnique({
    where: { receiptNumber },
    select: {
      receiptNumber: true,
      createdAt: true,
      amount: true,
      balanceAfter: true,
      reason: true,
      recordedBy: { select: { name: true } },
      reverses: { select: { receiptNumber: true } },
      reversedBy: { select: { receiptNumber: true } },
      order: { select: { id: true, number: true, total: true, contact: true, createdAt: true, customer: { select: { userId: true } } } },
    },
  });
  if (!payment || !canViewReceipt(viewer, payment.order)) return null;
  const company = await getSetting("company", client);
  const contact = payment.order.contact as unknown as Contact;
  return {
    receiptNumber: payment.receiptNumber,
    createdAt: payment.createdAt,
    amount: payment.amount,
    balanceAfter: payment.balanceAfter,
    orderNumber: payment.order.number,
    orderTotal: payment.order.total,
    customer: { name: contact.name, phone: contact.phone },
    recordedBy: payment.recordedBy.name,
    reversal: payment.reverses ? { receiptNumber: payment.reverses.receiptNumber, reason: payment.reason ?? "" } : null,
    voidedBy: payment.reversedBy?.receiptNumber ?? null,
    company: {
      name: company.companyName,
      address: company.address,
      phone: company.phone,
      email: company.email,
      ninea: company.ninea,
      rccm: company.rccm,
    },
  };
}

function canViewReceipt(viewer: ReceiptViewer, order: { id: string; createdAt: Date; customer: { userId: string | null } }): boolean {
  const { user } = viewer;
  if (user && (user.permissions.has("payments.read") || user.permissions.has("payments.record"))) return true;
  if (user && order.customer.userId === user.id) return true;
  return order.customer.userId === null && guestLinkAllows(order, viewer.token);
}
