import "server-only";
import type { Prisma, PrismaClient } from "@/generated/prisma/client";
import { businessDateKey, businessDayRange, businessYear, formatDate } from "@/lib/dates";
import { recordAudit } from "@/server/audit/audit";
import { assertPermission, type Actor } from "@/server/authz/service";
import { AppError } from "@/server/errors";
import { guestLinkAllows } from "@/server/modules/orders/queries";
import type { Contact } from "@/server/modules/orders/schemas";
import { paymentStatusFor } from "@/server/modules/payments/balance";
import { nextBusinessNumber } from "@/server/modules/sequences/service";
import { getSetting } from "@/server/modules/settings/service";
import { dispatchNotifications, queueNotifications } from "@/server/notifications/queue";
import { parseInput } from "@/server/validation";
import { priceQuote } from "./pricing";
import { quoteDecisionSchema, quoteDraftSchema } from "./schemas";

type Tx = Prisma.TransactionClient;

/** Validité proposée par défaut à la création d'un devis. */
export const DEFAULT_QUOTE_VALIDITY_DAYS = 30;
const DAY_MS = 24 * 3600 * 1000;

/** Fin de la journée de Dakar indiquée (AAAA-MM-JJ), qui ne doit pas être passée. */
function endOfBusinessDay(key: string): Date {
  const range = businessDayRange(key);
  if (!range) throw new AppError("VALIDATION", "Date de validité invalide.", { fieldErrors: { validUntil: ["Date invalide"] } });
  if (key < businessDateKey()) {
    throw new AppError("VALIDATION", "La date de validité est déjà passée.", { fieldErrors: { validUntil: ["Date passée"] } });
  }
  return new Date(range.to.getTime() - 1);
}

/**
 * Verrouille la demande du devis PUIS le devis (même ordre que createQuoteDraft,
 * createDirectIntervention et changeQuoteRequestStatus, qui verrouillent la demande) :
 * une décision, un envoi et une clôture de la même demande s'exécutent l'un après l'autre.
 */
async function lockQuote(tx: Tx, quoteId: string) {
  const owner = await tx.quote.findUnique({ where: { id: quoteId }, select: { quoteRequestId: true } });
  if (!owner) throw new AppError("NOT_FOUND", "Devis introuvable.");
  if (owner.quoteRequestId) await tx.$queryRaw`SELECT id FROM quote_requests WHERE id = ${owner.quoteRequestId} FOR UPDATE`;
  const [locked] = await tx.$queryRaw<{ id: string }[]>`SELECT id FROM quotes WHERE id = ${quoteId} FOR UPDATE`;
  if (!locked) throw new AppError("NOT_FOUND", "Devis introuvable.");
  return tx.quote.findUniqueOrThrow({
    where: { id: quoteId },
    select: {
      id: true,
      number: true,
      status: true,
      validUntil: true,
      total: true,
      createdAt: true,
      customerId: true,
      customer: { select: { userId: true } },
      _count: { select: { items: true } },
      quoteRequest: { select: { id: true, status: true, contact: true, address: true, description: true, serviceId: true } },
    },
  });
}

/** Crée un devis en brouillon pour une demande (permission quotes.manage). */
export async function createQuoteDraft(client: PrismaClient, actor: Actor, quoteRequestId: string): Promise<{ id: string; number: string }> {
  await assertPermission(client, actor, "quotes.manage");
  return client.$transaction(async (tx) => {
    const [request] = await tx.$queryRaw<{ customerId: string; status: string }[]>`
      SELECT "customerId", status FROM quote_requests WHERE id = ${quoteRequestId} FOR UPDATE`;
    if (!request) throw new AppError("NOT_FOUND", "Demande introuvable.");
    if (request.status === "ACCEPTED" || request.status === "CANCELLED") throw new AppError("CONFLICT", "Cette demande est close.");
    const number = await nextBusinessNumber(tx, "quote", businessYear());
    const validUntil = endOfBusinessDay(businessDateKey(new Date(Date.now() + DEFAULT_QUOTE_VALIDITY_DAYS * DAY_MS)));
    const quote = await tx.quote.create({
      data: { number, quoteRequestId, customerId: request.customerId, validUntil, createdById: actor.id },
      select: { id: true, number: true },
    });
    if (request.status === "NEW") await tx.quoteRequest.update({ where: { id: quoteRequestId }, data: { status: "IN_REVIEW" } });
    await recordAudit(tx, { actorId: actor.id, action: "quote.create", entityType: "Quote", entityId: quote.id, after: { number, quoteRequestId } });
    return quote;
  });
}

/** Enregistre le brouillon : lignes remplacées, totaux recalculés par le serveur. */
export async function saveQuoteDraft(client: PrismaClient, actor: Actor, quoteId: string, input: unknown): Promise<{ total: number }> {
  await assertPermission(client, actor, "quotes.manage");
  const draft = parseInput(quoteDraftSchema, input, "Devis");
  const validUntil = endOfBusinessDay(draft.validUntil);
  const priced = priceQuote(draft.items);
  return client.$transaction(async (tx) => {
    const quote = await lockQuote(tx, quoteId);
    if (quote.status !== "DRAFT") throw new AppError("CONFLICT", "Un devis envoyé ne se modifie plus : créez-en un nouveau.");
    assertRequestOpen(quote);
    await tx.quoteItem.deleteMany({ where: { quoteId } });
    if (priced.items.length > 0) await tx.quoteItem.createMany({ data: priced.items.map((item) => ({ ...item, quoteId })) });
    await tx.quote.update({ where: { id: quoteId }, data: { validUntil, notes: draft.notes, subtotal: priced.subtotal, total: priced.total } });
    await recordAudit(tx, {
      actorId: actor.id,
      action: "quote.update",
      entityType: "Quote",
      entityId: quoteId,
      after: { total: priced.total, lines: priced.items.length, validUntil },
    });
    return { total: priced.total };
  });
}

/** Envoie le devis au client : il est figé, la demande passe « devis envoyé », le client est notifié. */
export async function sendQuote(client: PrismaClient, actor: Actor, quoteId: string): Promise<void> {
  await assertPermission(client, actor, "quotes.manage");
  await client.$transaction(async (tx) => {
    const quote = await lockQuote(tx, quoteId);
    if (quote.status !== "DRAFT") throw new AppError("CONFLICT", "Ce devis est déjà envoyé.");
    assertRequestOpen(quote);
    if (quote._count.items === 0) throw new AppError("CONFLICT", "Ajoutez au moins une ligne avant d'envoyer le devis.");
    if (quote.validUntil < new Date()) throw new AppError("CONFLICT", "La date de validité est passée : modifiez-la avant d'envoyer.");
    await tx.quote.update({ where: { id: quoteId }, data: { status: "SENT", sentAt: new Date() } });
    if (quote.quoteRequest) await tx.quoteRequest.update({ where: { id: quote.quoteRequest.id }, data: { status: "QUOTED" } });
    const contact = quote.quoteRequest?.contact as unknown as Contact | undefined;
    if (contact) {
      await queueNotifications(
        tx,
        { quoteId },
        "quote.sent",
        { number: quote.number, customerName: contact.name, total: quote.total, validUntil: formatDate(quote.validUntil) },
        { email: contact.email, phone: contact.phone },
      );
    }
    await recordAudit(tx, { actorId: actor.id, action: "quote.send", entityType: "Quote", entityId: quoteId, after: { total: quote.total } });
  });
  await dispatchNotifications(client, { quoteId });
}

/** Qui décide : le personnel (accord reçu par téléphone), le titulaire du compte, ou l'invité muni du lien. */
export type QuoteDecider = { kind: "staff"; actor: Actor } | { kind: "customer"; userId: string } | { kind: "guest"; token: string | undefined };

type LockedQuote = Awaited<ReturnType<typeof lockQuote>>;

/** Demande close (sans suite, ou déjà convertie en intervention) : son devis ne s'envoie ni ne s'accepte plus. */
function assertRequestOpen(quote: Pick<LockedQuote, "quoteRequest">): void {
  const status = quote.quoteRequest?.status;
  if (status === "ACCEPTED" || status === "CANCELLED") throw new AppError("CONFLICT", "Cette demande est close.");
}

function canDecide(decider: QuoteDecider, quote: LockedQuote): boolean {
  if (decider.kind === "staff") return true;
  if (decider.kind === "customer") return quote.customer.userId === decider.userId;
  return quote.customer.userId === null && guestLinkAllows(quote, decider.token, "quote");
}

/**
 * Acceptation ou refus d'un devis envoyé et encore valide. L'acceptation crée l'intervention
 * à planifier (montant dû = total du devis) et clôt la demande ; le personnel est notifié.
 */
export async function decideQuote(
  client: PrismaClient,
  decider: QuoteDecider,
  quoteId: string,
  input: unknown,
): Promise<{ interventionNumber: string | null }> {
  if (decider.kind === "staff") await assertPermission(client, decider.actor, "quotes.manage");
  const { accept, note } = parseInput(quoteDecisionSchema, input, "Décision");
  const decidedById = decider.kind === "staff" ? decider.actor.id : decider.kind === "customer" ? decider.userId : null;

  const result = await client.$transaction(async (tx) => {
    const quote = await lockQuote(tx, quoteId);
    if (!canDecide(decider, quote)) throw new AppError("NOT_FOUND", "Devis introuvable.");
    if (quote.status !== "SENT") throw new AppError("CONFLICT", "Ce devis n'attend plus de réponse.");
    if (quote.validUntil < new Date()) throw new AppError("CONFLICT", "Ce devis a expiré : contactez-nous pour un nouveau devis.");
    // Demande close entre-temps (sans suite, ou déjà convertie en intervention) : plus de décision possible.
    if (accept) assertRequestOpen(quote);

    await tx.quote.update({
      where: { id: quoteId },
      data: { status: accept ? "ACCEPTED" : "REFUSED", decidedAt: new Date(), decidedById, decisionNote: note },
    });
    const interventionNumber = accept ? await createInterventionFromQuote(tx, quote) : null;
    const contact = quote.quoteRequest?.contact as unknown as Contact | undefined;
    const company = await getSetting("company", tx);
    await queueNotifications(tx, { quoteId }, "quote.decided_staff", { number: quote.number, customerName: contact?.name ?? "", accepted: accept }, {
      email: company.email,
      phone: null,
    });
    await recordAudit(tx, {
      actorId: decidedById,
      action: accept ? "quote.accept" : "quote.refuse",
      entityType: "Quote",
      entityId: quoteId,
      after: { by: decider.kind, note, interventionNumber },
    });
    return { interventionNumber };
  });
  await dispatchNotifications(client, { quoteId });
  return result;
}

async function createInterventionFromQuote(tx: Tx, quote: LockedQuote): Promise<string> {
  const request = quote.quoteRequest;
  if (!request) throw new AppError("CONFLICT", "Ce devis n'est rattaché à aucune demande.");
  const number = await nextBusinessNumber(tx, "intervention", businessYear());
  await tx.intervention.create({
    data: {
      number,
      customerId: quote.customerId,
      quoteRequestId: request.id,
      quoteId: quote.id,
      serviceId: request.serviceId,
      contact: request.contact as Prisma.InputJsonValue,
      address: request.address,
      problem: request.description,
      amountDue: quote.total,
      paymentStatus: paymentStatusFor(quote.total, 0),
    },
  });
  await tx.quoteRequest.update({ where: { id: request.id }, data: { status: "ACCEPTED" } });
  await closeOtherQuotes(tx, request.id, quote.id);
  return number;
}

/** Une demande ne donne qu'une intervention : ses autres devis en attente ne sont plus acceptables. */
export async function closeOtherQuotes(tx: Tx, quoteRequestId: string, keptQuoteId: string | null): Promise<void> {
  await tx.quote.updateMany({
    where: { quoteRequestId, status: "SENT", ...(keptQuoteId ? { id: { not: keptQuoteId } } : {}) },
    data: { status: "EXPIRED" },
  });
}

/** Passe « expirés » les devis envoyés dont la validité est dépassée (tâche planifiée). */
export async function expireQuotes(client: PrismaClient, now: Date = new Date()): Promise<number> {
  return (await client.quote.updateMany({ where: { status: "SENT", validUntil: { lt: now } }, data: { status: "EXPIRED" } })).count;
}
