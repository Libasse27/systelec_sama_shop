import "server-only";
import type { Prisma } from "@/generated/prisma/client";
import type { Permission } from "@/server/authz/permissions";
import { assertPermission, type Actor } from "@/server/authz/service";
import type { Db } from "@/server/db/client";
import { guestLinkAllows } from "@/server/modules/orders/queries";
import type { Contact } from "@/server/modules/orders/schemas";
import { getSetting } from "@/server/modules/settings/service";
import { targetLink, type PaymentTarget } from "./targets";

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
  /** Remboursement : le retour remboursé. */
  refundOf: string | null;
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
  return: { select: { number: true } },
} satisfies Prisma.PaymentSelect;

const toAdminRow = ({ recordedBy, reverses, reversedBy, return: refunded, ...payment }: Prisma.PaymentGetPayload<{ select: typeof ADMIN_PAYMENT_SELECT }>) => ({
  ...payment,
  recordedBy: recordedBy.name,
  reverses: reverses?.receiptNumber ?? null,
  reversedBy: reversedBy?.receiptNumber ?? null,
  refundOf: refunded?.number ?? null,
});

/** Encaissements d'un document : visibles avec payments.read, ou payments.record (le caissier voit ce qu'il saisit). */
export async function listPayments(client: Db, actor: Actor, target: PaymentTarget): Promise<AdminPaymentRow[]> {
  const permission = actor.permissions.has("payments.read") ? "payments.read" : "payments.record";
  await assertPermission(client, actor, permission);
  const payments = await client.payment.findMany({
    where: targetLink(target),
    orderBy: [{ createdAt: "asc" }, { id: "asc" }],
    select: ADMIN_PAYMENT_SELECT,
  });
  return payments.map(toAdminRow);
}

export const listOrderPayments = (client: Db, actor: Actor, orderId: string) => listPayments(client, actor, { kind: "order", id: orderId });

// ─── Journal de caisse ───────────────────────────────────────────────────────

export const JOURNAL_LIMIT = 500;

/** Document réglé par une écriture (lien vers sa fiche d'administration). */
export interface PaymentDocument {
  kind: "order" | "intervention";
  id: string;
  number: string;
}

export interface JournalRow extends AdminPaymentRow {
  document: PaymentDocument;
}

const documentOf = (payment: { order: { id: string; number: string } | null; intervention: { id: string; number: string } | null }): PaymentDocument => {
  if (payment.order) return { kind: "order", ...payment.order };
  if (payment.intervention) return { kind: "intervention", ...payment.intervention };
  throw new Error("Encaissement sans commande ni intervention");
};

export interface PaymentJournal {
  rows: JournalRow[];
  /** Vrai si la journée compte plus de lignes que la limite affichée (les totaux restent complets). */
  truncated: boolean;
  /** Encaissé, annulé (contre-écritures), remboursé (retours) et net en caisse. */
  totals: { received: number; voided: number; refunded: number; net: number; count: number };
  /** Net encaissé par agent : ce que chacun doit remettre en caisse. */
  byRecorder: { name: string; net: number; count: number }[];
}

/** Encaissements et contre-écritures d'une période [from, to[ (journée de caisse). */
export async function getPaymentJournal(client: Db, actor: Actor, range: { from: Date; to: Date }): Promise<PaymentJournal> {
  await assertPermission(client, actor, "payments.read");
  const where: Prisma.PaymentWhereInput = { createdAt: { gte: range.from, lt: range.to } };
  const [payments, received, voided, refunded, perRecorder] = await Promise.all([
    client.payment.findMany({
      where,
      orderBy: [{ createdAt: "desc" }, { id: "desc" }],
      take: JOURNAL_LIMIT + 1,
      select: { ...ADMIN_PAYMENT_SELECT, order: { select: { id: true, number: true } }, intervention: { select: { id: true, number: true } } },
    }),
    client.payment.aggregate({ where: { ...where, amount: { gt: 0 } }, _sum: { amount: true }, _count: true }),
    client.payment.aggregate({ where: { ...where, amount: { lt: 0 }, returnId: null }, _sum: { amount: true }, _count: true }),
    client.payment.aggregate({ where: { ...where, returnId: { not: null } }, _sum: { amount: true }, _count: true }),
    client.payment.groupBy({ by: ["recordedById"], where, _sum: { amount: true }, _count: true }),
  ]);
  const recorders = await client.user.findMany({ where: { id: { in: perRecorder.map((row) => row.recordedById) } }, select: { id: true, name: true } });
  const names = new Map(recorders.map((user) => [user.id, user.name]));
  const receivedTotal = received._sum.amount ?? 0;
  // « 0 - » et non « - » : une somme vide doit donner 0, pas -0 (affiché « -0 FCFA »).
  const voidedTotal = 0 - (voided._sum.amount ?? 0);
  const refundedTotal = 0 - (refunded._sum.amount ?? 0);
  return {
    rows: payments.slice(0, JOURNAL_LIMIT).map(({ order, intervention, ...payment }) => ({ ...toAdminRow(payment), document: documentOf({ order, intervention }) })),
    truncated: payments.length > JOURNAL_LIMIT,
    totals: {
      received: receivedTotal,
      voided: voidedTotal,
      refunded: refundedTotal,
      net: receivedTotal - voidedTotal - refundedTotal,
      count: received._count + voided._count + refunded._count,
    },
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
  /** Document réglé : « Commande » ou « Intervention », son numéro et son montant total. */
  document: { label: string; number: string; total: number };
  customer: { name: string; phone: string };
  recordedBy: string;
  /** Contre-écriture : le reçu annulé et le motif. */
  reversal: { receiptNumber: string; reason: string } | null;
  /** Remboursement d'un retour : son numéro et le motif. */
  refund: { returnNumber: string; reason: string } | null;
  /** Encaissement annulé depuis (mention sur le reçu d'origine). */
  voidedBy: string | null;
  company: CompanyHeader;
}

export interface CompanyHeader {
  name: string;
  address: string | null;
  phone: string | null;
  email: string | null;
  ninea: string | null;
  rccm: string | null;
}

export interface DocumentViewer {
  /** Utilisateur connecté (personnel ou client), ou null. */
  user: Actor | null;
  /** Jeton du lien de suivi d'un invité (commande, ou devis pour une intervention). */
  token?: string;
}

/** En-tête société des documents imprimés (mentions légales D7 si renseignées). */
export async function companyHeader(client: Db): Promise<CompanyHeader> {
  const company = await getSetting("company", client);
  return { name: company.companyName, address: company.address, phone: company.phone, email: company.email, ninea: company.ninea, rccm: company.rccm };
}

const OWNER_SELECT = { id: true, createdAt: true, contact: true, customer: { select: { userId: true } } } as const;

/** Propriétaire d'un document réglé, pour décider qui peut voir ses reçus et factures. */
export interface OwnedDocument {
  customerUserId: string | null;
  /** Lien de suivi invité valide pour ce jeton. */
  guestAllows: (token: string | undefined) => boolean;
}

type LinkedDocument = { id: string; createdAt: Date } | null;

/**
 * Commande : jeton de la commande. Intervention : jeton du devis accepté qui l'a créée, ou
 * celui de la demande (intervention à prix fixe, sans devis).
 */
export function ownershipOf(
  order: { id: string; createdAt: Date; customer: { userId: string | null } } | null,
  intervention: { customer: { userId: string | null }; quote: LinkedDocument; quoteRequest: LinkedDocument } | null,
): OwnedDocument {
  if (order) return { customerUserId: order.customer.userId, guestAllows: (token) => guestLinkAllows(order, token, "order") };
  if (intervention) {
    const { quote, quoteRequest } = intervention;
    return {
      customerUserId: intervention.customer.userId,
      guestAllows: (token) =>
        (quote !== null && guestLinkAllows(quote, token, "quote")) || (quoteRequest !== null && guestLinkAllows(quoteRequest, token, "quote_request")),
    };
  }
  return { customerUserId: null, guestAllows: () => false };
}

/**
 * Accès d'un lecteur à un document payé : le personnel autorisé (permissions données), le
 * titulaire du compte, ou l'invité muni du lien de suivi. Les documents d'un compte ne
 * s'ouvrent jamais avec un simple jeton.
 */
export function canViewDocument(viewer: DocumentViewer, owner: OwnedDocument, staffPermissions: readonly Permission[]): boolean {
  const { user } = viewer;
  if (user && staffPermissions.some((permission) => user.permissions.has(permission))) return true;
  if (owner.customerUserId !== null) return user?.id === owner.customerUserId;
  return owner.guestAllows(viewer.token);
}

/**
 * Reçu, pour qui a le droit de le voir (sinon null : la page répond 404, sans dire si le
 * reçu existe). La note interne n'est jamais incluse.
 */
export async function getReceipt(client: Db, viewer: DocumentViewer, receiptNumber: string): Promise<ReceiptData | null> {
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
      return: { select: { number: true } },
      order: { select: { ...OWNER_SELECT, number: true, total: true } },
      intervention: {
        select: {
          number: true,
          amountDue: true,
          contact: true,
          customer: { select: { userId: true } },
          quote: { select: { id: true, createdAt: true } },
          quoteRequest: { select: { id: true, createdAt: true } },
        },
      },
    },
  });
  if (!payment) return null;
  if (!canViewDocument(viewer, ownershipOf(payment.order, payment.intervention), ["payments.read", "payments.record"])) return null;
  const document = payment.order
    ? { label: "Commande", number: payment.order.number, total: payment.order.total, contact: payment.order.contact }
    : { label: "Intervention", number: payment.intervention!.number, total: payment.intervention!.amountDue, contact: payment.intervention!.contact };
  const contact = document.contact as unknown as Contact;
  return {
    receiptNumber: payment.receiptNumber,
    createdAt: payment.createdAt,
    amount: payment.amount,
    balanceAfter: payment.balanceAfter,
    document: { label: document.label, number: document.number, total: document.total },
    customer: { name: contact.name, phone: contact.phone },
    recordedBy: payment.recordedBy.name,
    reversal: payment.reverses ? { receiptNumber: payment.reverses.receiptNumber, reason: payment.reason ?? "" } : null,
    refund: payment.return ? { returnNumber: payment.return.number, reason: payment.reason ?? "" } : null,
    voidedBy: payment.reversedBy?.receiptNumber ?? null,
    company: await companyHeader(client),
  };
}
