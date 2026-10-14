import "server-only";
import { z } from "zod";
import { Prisma, type PrismaClient } from "@/generated/prisma/client";
import { businessYear } from "@/lib/dates";
import { recordAudit } from "@/server/audit/audit";
import { assertPermission, type Actor } from "@/server/authz/service";
import type { Db } from "@/server/db/client";
import { isUniqueViolation } from "@/server/db/errors";
import { AppError } from "@/server/errors";
import { resolveCustomer } from "@/server/modules/customers/service";
import { accessToken } from "@/server/modules/orders/access-token";
import { nextBusinessNumber } from "@/server/modules/sequences/service";
import { getSetting } from "@/server/modules/settings/service";
import { dispatchNotifications, queueNotifications } from "@/server/notifications/queue";
import { parseInput } from "@/server/validation";
import { closeOtherQuotes } from "./quotes";
import { quoteRequestSchema, requestStatusSchema } from "./schemas";

/** Limites anti-abus du formulaire public de demande. */
export const REQUEST_LIMITS = {
  perIp: 10,
  windowMinutes: 60,
  /** Demandes encore ouvertes pour un téléphone, depuis une même connexion (un tiers ne bloque pas la victime). */
  openPerPhone: 5,
  /** Accusés de réception par adresse e-mail et par jour (le formulaire ne sert pas à arroser une adresse). */
  acknowledgementsPerEmailPerDay: 3,
} as const;

export interface RequestContext {
  /** Compte connecté, ou null pour un invité. */
  userId: string | null;
  ip?: string;
}

export interface SubmittedRequest {
  id: string;
  number: string;
  /** Lien de suivi pour un invité (null pour un compte). */
  accessToken: string | null;
}

async function assertRequestAllowed(client: Db, ip: string | undefined, phone: string): Promise<void> {
  if (ip) {
    const since = new Date(Date.now() - REQUEST_LIMITS.windowMinutes * 60_000);
    const recent = await client.auditLog.count({ where: { action: "quote_request.create", ip, createdAt: { gte: since } } });
    if (recent >= REQUEST_LIMITS.perIp) throw new AppError("RATE_LIMITED", "Trop de demandes depuis cette connexion. Réessayez plus tard ou appelez-nous.");
  }
  const digits = phone.replace(/\D/g, "");
  // Avec une IP connue, seules les demandes déposées depuis cette même connexion comptent.
  const sameIp = ip
    ? Prisma.sql`AND EXISTS (SELECT 1 FROM audit_logs a WHERE a."entityId" = q.id AND a.action = 'quote_request.create' AND a.ip = ${ip})`
    : Prisma.empty;
  const [open] = await client.$queryRaw<{ count: number }[]>`
    SELECT COUNT(*)::int AS count FROM quote_requests q JOIN customers c ON c.id = q."customerId"
    WHERE q.status IN ('NEW', 'IN_REVIEW') AND regexp_replace(c.phone, '\\D', '', 'g') = ${digits} ${sameIp}`;
  if ((open?.count ?? 0) >= REQUEST_LIMITS.openPerPhone) {
    throw new AppError("RATE_LIMITED", "Plusieurs demandes sont déjà en cours d'étude pour ce numéro : nous vous recontactons.");
  }
}

const tokenFor = (context: RequestContext, id: string) => (context.userId ? null : accessToken("quote_request", id));

/**
 * Demande déjà créée avec cette clé : renvoyée au même demandeur (même compte, ou invité).
 * La clé est un UUID aléatoire présent seulement dans le formulaire du demandeur.
 */
async function findReplay(client: Db, idempotencyKey: string, context: RequestContext): Promise<SubmittedRequest | null> {
  const existing = await client.quoteRequest.findUnique({
    where: { idempotencyKey },
    select: { id: true, number: true, customer: { select: { userId: true } } },
  });
  if (!existing) return null;
  if (existing.customer.userId !== context.userId) throw new AppError("CONFLICT", "Cette demande a déjà été envoyée.");
  return { id: existing.id, number: existing.number, accessToken: tokenFor(context, existing.id) };
}

/**
 * Dépose une demande de devis ou d'intervention (compte ou invité, téléphone obligatoire).
 * Une double soumission (même clé) renvoie la demande déjà créée, au même demandeur seulement.
 */
export async function submitQuoteRequest(client: PrismaClient, context: RequestContext, input: unknown): Promise<SubmittedRequest> {
  const request = parseInput(quoteRequestSchema, input, "Demande");
  const replay = await findReplay(client, request.idempotencyKey, context);
  if (replay) return replay;
  await assertRequestAllowed(client, context.ip, request.contact.phone);
  const service = request.serviceSlug
    ? await client.service.findFirst({ where: { slug: request.serviceSlug, isActive: true }, select: { id: true } })
    : null;

  let created: { id: string; number: string };
  try {
    created = await client.$transaction((tx) => createRequest(tx, context, request, service?.id ?? null));
  } catch (error) {
    // Double soumission simultanée : la seconde bute sur la clé unique et rejoue la première.
    if (isUniqueViolation(error)) {
      const concurrent = await findReplay(client, request.idempotencyKey, context);
      if (concurrent) return concurrent;
    }
    throw error;
  }
  await dispatchNotifications(client, { quoteRequestId: created.id });
  return { ...created, accessToken: tokenFor(context, created.id) };
}

async function createRequest(
  tx: Prisma.TransactionClient,
  context: RequestContext,
  request: z.infer<typeof quoteRequestSchema>,
  serviceId: string | null,
): Promise<{ id: string; number: string }> {
  const customerId = await resolveCustomer(tx, context.userId, request.contact);
  const number = await nextBusinessNumber(tx, "quote_request", businessYear());
  const row = await tx.quoteRequest.create({
    data: {
      number,
      idempotencyKey: request.idempotencyKey,
      customerId,
      serviceId,
      contact: request.contact,
      address: request.address,
      description: request.description,
      urgency: request.urgency,
      availability: request.availability,
    },
    select: { id: true, number: true },
  });
  const message = { number, customerName: request.contact.name };
  await queueNotifications(tx, { quoteRequestId: row.id }, "quote_request.received", message, {
    email: (await acknowledgementAllowed(tx, request.contact.email)) ? request.contact.email : null,
    phone: request.contact.phone,
  });
  const company = await getSetting("company", tx);
  await queueNotifications(tx, { quoteRequestId: row.id }, "quote_request.new_staff", message, { email: company.email, phone: null });
  await recordAudit(tx, {
    actorId: context.userId,
    action: "quote_request.create",
    entityType: "QuoteRequest",
    entityId: row.id,
    ip: context.ip,
    after: { number, urgency: request.urgency, serviceId },
  });
  return row;
}

/** L'adresse saisie n'est pas vérifiée : au-delà du plafond quotidien, la demande est enregistrée sans accusé par e-mail. */
async function acknowledgementAllowed(tx: Prisma.TransactionClient, email: string | null): Promise<boolean> {
  if (!email) return false;
  const since = new Date(Date.now() - 24 * 3600 * 1000);
  const sent = await tx.notification.count({ where: { channel: "EMAIL", template: "quote_request.received", recipient: email, createdAt: { gte: since } } });
  return sent < REQUEST_LIMITS.acknowledgementsPerEmailPerDay;
}

/** Prise en charge ou clôture sans suite d'une demande (permission quotes.manage). */
export async function changeQuoteRequestStatus(client: PrismaClient, actor: Actor, requestId: string, input: unknown): Promise<void> {
  await assertPermission(client, actor, "quotes.manage");
  const { status, note } = parseInput(requestStatusSchema, input, "Statut de la demande");
  await client.$transaction(async (tx) => {
    const [locked] = await tx.$queryRaw<{ status: string }[]>`SELECT status FROM quote_requests WHERE id = ${requestId} FOR UPDATE`;
    if (!locked) throw new AppError("NOT_FOUND", "Demande introuvable.");
    if (locked.status === "ACCEPTED" || locked.status === "CANCELLED") throw new AppError("CONFLICT", "Cette demande est déjà close.");
    if (status === "IN_REVIEW" && locked.status !== "NEW") throw new AppError("CONFLICT", "Cette demande est déjà prise en charge.");
    await tx.quoteRequest.update({ where: { id: requestId }, data: { status, ...(status === "CANCELLED" && { closingNote: note }) } });
    if (status === "CANCELLED") await closeOtherQuotes(tx, requestId, null);
    await recordAudit(tx, {
      actorId: actor.id,
      action: "quote_request.status",
      entityType: "QuoteRequest",
      entityId: requestId,
      before: { status: locked.status },
      after: { status, note },
    });
  });
}
