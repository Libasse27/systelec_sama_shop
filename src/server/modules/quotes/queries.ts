import "server-only";
import type { InterventionStatus, PaymentStatus, Prisma, QuoteItemKind, QuoteRequestStatus, QuoteStatus, Urgency } from "@/generated/prisma/client";
import { assertPermission, type Actor } from "@/server/authz/service";
import type { Db } from "@/server/db/client";
import { accessToken } from "@/server/modules/orders/access-token";
import { guestLinkAllows } from "@/server/modules/orders/queries";
import type { Contact } from "@/server/modules/orders/schemas";

/** Lecteur côté client : le compte connecté, ou un invité muni du jeton de son lien. */
export interface CustomerViewer {
  userId: string | null;
  token?: string;
}

/** Un devis envoyé dont la validité est dépassée est « expiré », même avant le passage de la tâche planifiée. */
export const effectiveQuoteStatus = (status: QuoteStatus, validUntil: Date, now: Date = new Date()): QuoteStatus =>
  status === "SENT" && validUntil < now ? "EXPIRED" : status;

// ─── Intervention (vue client) ───────────────────────────────────────────────

/** Ce que le client voit de son intervention : ni rapport, ni pièces, ni coûts internes. */
const CUSTOMER_INTERVENTION_SELECT = {
  number: true,
  status: true,
  paymentStatus: true,
  amountDue: true,
  amountPaid: true,
  completedAt: true,
  invoice: { select: { number: true } },
  appointments: { orderBy: { startsAt: "asc" }, take: 1, select: { startsAt: true, endsAt: true, technician: { select: { user: { select: { name: true } } } } } },
  payments: { orderBy: [{ createdAt: "asc" }, { id: "asc" }], select: { receiptNumber: true, amount: true, createdAt: true } },
} satisfies Prisma.InterventionSelect;

function toCustomerIntervention(row: Prisma.InterventionGetPayload<{ select: typeof CUSTOMER_INTERVENTION_SELECT }>): CustomerIntervention {
  const appointment = row.appointments[0];
  return {
    number: row.number,
    status: row.status,
    paymentStatus: row.paymentStatus,
    amountDue: row.amountDue,
    amountPaid: row.amountPaid,
    completedAt: row.completedAt,
    appointment: appointment ? { startsAt: appointment.startsAt, endsAt: appointment.endsAt, technician: appointment.technician.user.name } : null,
    receipts: row.payments,
    invoiceNumber: row.invoice?.number ?? null,
  };
}

// ─── Demande (vue client) ────────────────────────────────────────────────────

export interface RequestView {
  id: string;
  number: string;
  status: QuoteRequestStatus;
  createdAt: Date;
  serviceName: string | null;
  address: string;
  description: string;
  urgency: Urgency;
  availability: string | null;
  closingNote: string | null;
  contact: Contact;
  /** Devis envoyés (jamais les brouillons), avec leur lien (jeton pour un invité). */
  quotes: { number: string; status: QuoteStatus; total: number; validUntil: Date; href: string }[];
  /** Intervention à prix fixe créée sans devis (sinon, elle se suit depuis le devis accepté). */
  directIntervention: CustomerIntervention | null;
}

const quoteHref = (quote: { id: string; number: string }, guest: boolean) =>
  guest ? `/devis/${quote.number}?jeton=${accessToken("quote", quote.id)}` : `/devis/${quote.number}`;

/** Demande du compte connecté, ou demande invitée avec le jeton de son lien. */
export async function getRequestForViewer(client: Db, viewer: CustomerViewer, number: string): Promise<RequestView | null> {
  const request = await client.quoteRequest.findUnique({
    where: { number },
    select: {
      id: true,
      number: true,
      status: true,
      createdAt: true,
      address: true,
      description: true,
      urgency: true,
      availability: true,
      closingNote: true,
      contact: true,
      service: { select: { name: true } },
      customer: { select: { userId: true } },
      quotes: {
        where: { status: { not: "DRAFT" } },
        orderBy: { createdAt: "asc" },
        select: { id: true, number: true, status: true, total: true, validUntil: true },
      },
      interventions: { where: { quoteId: null }, orderBy: { createdAt: "desc" }, take: 1, select: CUSTOMER_INTERVENTION_SELECT },
    },
  });
  if (!request) return null;
  const owner = request.customer.userId;
  const allowed = owner !== null ? viewer.userId === owner : guestLinkAllows(request, viewer.token, "quote_request");
  if (!allowed) return null;
  const { service, customer, quotes, contact, interventions, ...rest } = request;
  return {
    ...rest,
    directIntervention: interventions[0] ? toCustomerIntervention(interventions[0]) : null,
    contact: contact as unknown as Contact,
    serviceName: service?.name ?? null,
    quotes: quotes.map((quote) => ({ ...quote, status: effectiveQuoteStatus(quote.status, quote.validUntil), href: quoteHref(quote, customer.userId === null) })),
  };
}

// ─── Devis (vue client) ──────────────────────────────────────────────────────

export interface CustomerIntervention {
  number: string;
  status: InterventionStatus;
  paymentStatus: PaymentStatus;
  amountDue: number;
  amountPaid: number;
  appointment: { startsAt: Date; endsAt: Date; technician: string } | null;
  completedAt: Date | null;
  receipts: { receiptNumber: string; amount: number; createdAt: Date }[];
  invoiceNumber: string | null;
}

export interface QuoteView {
  id: string;
  number: string;
  status: QuoteStatus;
  validUntil: Date;
  sentAt: Date | null;
  decidedAt: Date | null;
  total: number;
  notes: string | null;
  items: { kind: QuoteItemKind; label: string; quantity: number; unitPrice: number; lineTotal: number }[];
  request: { number: string; address: string; contact: Contact } | null;
  intervention: CustomerIntervention | null;
  /** Le lecteur peut accepter ou refuser (devis envoyé et valide). */
  canDecide: boolean;
}

/** Devis envoyé, du compte connecté, ou invité avec le jeton de son lien. Les brouillons ne sont jamais visibles. */
export async function getQuoteForViewer(client: Db, viewer: CustomerViewer, number: string): Promise<QuoteView | null> {
  const quote = await client.quote.findUnique({
    where: { number },
    select: {
      id: true,
      number: true,
      status: true,
      validUntil: true,
      sentAt: true,
      decidedAt: true,
      total: true,
      notes: true,
      createdAt: true,
      customer: { select: { userId: true } },
      items: { orderBy: { position: "asc" }, select: { kind: true, label: true, quantity: true, unitPrice: true, lineTotal: true } },
      quoteRequest: { select: { number: true, address: true, contact: true } },
      intervention: { select: CUSTOMER_INTERVENTION_SELECT },
    },
  });
  if (!quote || quote.status === "DRAFT") return null;
  const owner = quote.customer.userId;
  const allowed = owner !== null ? viewer.userId === owner : guestLinkAllows(quote, viewer.token, "quote");
  if (!allowed) return null;
  const status = effectiveQuoteStatus(quote.status, quote.validUntil);
  return {
    id: quote.id,
    number: quote.number,
    status,
    validUntil: quote.validUntil,
    sentAt: quote.sentAt,
    decidedAt: quote.decidedAt,
    total: quote.total,
    notes: quote.notes,
    items: quote.items,
    request: quote.quoteRequest && { ...quote.quoteRequest, contact: quote.quoteRequest.contact as unknown as Contact },
    canDecide: status === "SENT",
    intervention: quote.intervention && toCustomerIntervention(quote.intervention),
  };
}

/** Demandes d'un compte (« Mon compte »), avec leurs devis envoyés. */
export async function listCustomerRequests(
  client: Db,
  userId: string,
): Promise<{ number: string; status: QuoteRequestStatus; createdAt: Date; serviceName: string | null; quotes: { number: string; status: QuoteStatus }[] }[]> {
  const requests = await client.quoteRequest.findMany({
    where: { customer: { userId } },
    orderBy: { createdAt: "desc" },
    take: 100,
    select: {
      number: true,
      status: true,
      createdAt: true,
      service: { select: { name: true } },
      quotes: { where: { status: { not: "DRAFT" } }, orderBy: { createdAt: "asc" }, select: { number: true, status: true, validUntil: true } },
    },
  });
  return requests.map(({ service, quotes, ...request }) => ({
    ...request,
    serviceName: service?.name ?? null,
    quotes: quotes.map((quote) => ({ number: quote.number, status: effectiveQuoteStatus(quote.status, quote.validUntil) })),
  }));
}

// ─── Administration ──────────────────────────────────────────────────────────

export const ADMIN_REQUESTS_PAGE_SIZE = 30;

export interface AdminRequestRow {
  id: string;
  number: string;
  status: QuoteRequestStatus;
  urgency: Urgency;
  createdAt: Date;
  customerName: string;
  customerPhone: string;
  serviceName: string | null;
}

export async function listAdminRequests(
  client: Db,
  actor: Actor,
  options: { status?: QuoteRequestStatus; q?: string; page?: number } = {},
): Promise<{ rows: AdminRequestRow[]; total: number; page: number; pageCount: number }> {
  await assertPermission(client, actor, "quotes.read");
  const q = options.q?.trim().slice(0, 100);
  const where: Prisma.QuoteRequestWhereInput = {
    ...(options.status ? { status: options.status } : {}),
    ...(q
      ? { OR: [{ number: { contains: q, mode: "insensitive" } }, { customer: { name: { contains: q, mode: "insensitive" } } }, { customer: { phone: { contains: q } } }] }
      : {}),
  };
  const total = await client.quoteRequest.count({ where });
  const pageCount = Math.max(1, Math.ceil(total / ADMIN_REQUESTS_PAGE_SIZE));
  const page = Math.min(Math.max(1, Math.trunc(options.page ?? 1)), pageCount);
  const rows = await client.quoteRequest.findMany({
    where,
    // Urgences d'abord, puis les plus récentes.
    orderBy: [{ urgency: "desc" }, { createdAt: "desc" }, { id: "desc" }],
    skip: (page - 1) * ADMIN_REQUESTS_PAGE_SIZE,
    take: ADMIN_REQUESTS_PAGE_SIZE,
    select: { id: true, number: true, status: true, urgency: true, createdAt: true, customer: { select: { name: true, phone: true } }, service: { select: { name: true } } },
  });
  return {
    rows: rows.map(({ customer, service, ...row }) => ({ ...row, customerName: customer.name, customerPhone: customer.phone, serviceName: service?.name ?? null })),
    total,
    page,
    pageCount,
  };
}

export async function getAdminRequest(client: Db, actor: Actor, id: string) {
  await assertPermission(client, actor, "quotes.read");
  const request = await client.quoteRequest.findUnique({
    where: { id },
    select: {
      id: true,
      number: true,
      status: true,
      urgency: true,
      createdAt: true,
      address: true,
      description: true,
      availability: true,
      closingNote: true,
      contact: true,
      service: { select: { name: true, pricingMode: true, price: true } },
      customer: { select: { userId: true } },
      quotes: { orderBy: { createdAt: "asc" }, select: { id: true, number: true, status: true, total: true, validUntil: true } },
      interventions: { select: { id: true, number: true, status: true } },
    },
  });
  if (!request) return null;
  return {
    ...request,
    contact: request.contact as unknown as Contact,
    hasAccount: request.customer.userId !== null,
    quotes: request.quotes.map((quote) => ({ ...quote, status: effectiveQuoteStatus(quote.status, quote.validUntil) })),
  };
}

export type AdminRequest = NonNullable<Awaited<ReturnType<typeof getAdminRequest>>>;

export async function getAdminQuote(client: Db, actor: Actor, id: string) {
  await assertPermission(client, actor, "quotes.read");
  const quote = await client.quote.findUnique({
    where: { id },
    select: {
      id: true,
      number: true,
      status: true,
      validUntil: true,
      subtotal: true,
      total: true,
      notes: true,
      sentAt: true,
      decidedAt: true,
      decisionNote: true,
      createdAt: true,
      items: { orderBy: { position: "asc" }, select: { kind: true, label: true, quantity: true, unitPrice: true, lineTotal: true } },
      quoteRequest: { select: { id: true, number: true, contact: true, address: true, description: true } },
      intervention: { select: { id: true, number: true } },
    },
  });
  if (!quote) return null;
  return {
    ...quote,
    status: effectiveQuoteStatus(quote.status, quote.validUntil),
    quoteRequest: quote.quoteRequest && { ...quote.quoteRequest, contact: quote.quoteRequest.contact as unknown as Contact },
  };
}

export type AdminQuote = NonNullable<Awaited<ReturnType<typeof getAdminQuote>>>;
