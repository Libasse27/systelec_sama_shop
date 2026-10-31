import "server-only";
import type { Prisma, PrismaClient } from "@/generated/prisma/client";
import { businessYear } from "@/lib/dates";
import { CONTACT_SUBJECT_LABELS } from "@/lib/labels";
import { recordAudit } from "@/server/audit/audit";
import { ipNetwork } from "@/server/auth/client-ip";
import { assertPermission, type Actor } from "@/server/authz/service";
import type { Db } from "@/server/db/client";
import { isUniqueViolation } from "@/server/db/errors";
import { AppError } from "@/server/errors";
import { logger } from "@/server/logger";
import { nextBusinessNumber } from "@/server/modules/sequences/service";
import { getSetting } from "@/server/modules/settings/service";
import { dispatchNotifications, queueNotifications } from "@/server/notifications/queue";
import { parseInput } from "@/server/validation";
import { contactMessageSchema, contactNotesSchema, contactStatusSchema, type ContactMessageInput } from "./schemas";

/** Limites anti-abus du formulaire public de contact. */
export const CONTACT_LIMITS = {
  perIp: 5,
  windowMinutes: 60,
  /** Accusés de réception par adresse e-mail et par jour (le formulaire ne sert pas à arroser une adresse). */
  acknowledgementsPerEmailPerDay: 3,
} as const;

export interface ContactContext {
  /** Compte connecté, ou null pour un invité. */
  userId: string | null;
  ip?: string;
}

export interface SubmittedContactMessage {
  id: string;
  number: string;
}

const DAY_MS = 24 * 3600 * 1000;

/**
 * Plafond par connexion seulement : aucun plafond commun à tous les visiteurs, qu'un abus suffirait à
 * atteindre pour fermer le formulaire à tout le monde. IP inconnue (TRUSTED_PROXY_HOPS=0) : pas de plafond.
 */
async function assertAllowed(client: Db, ip: string | undefined): Promise<void> {
  if (!ip) return;
  const since = new Date(Date.now() - CONTACT_LIMITS.windowMinutes * 60_000);
  const recent = await client.auditLog.count({ where: { action: "contact_message.create", ip, createdAt: { gte: since } } });
  if (recent >= CONTACT_LIMITS.perIp) {
    throw new AppError("RATE_LIMITED", "Trop de messages envoyés depuis cette connexion. Réessayez plus tard ou appelez-nous.");
  }
}

/** Message déjà créé avec cette clé (double soumission) : renvoyé au même expéditeur seulement. */
async function findReplay(client: Db, idempotencyKey: string, context: ContactContext): Promise<SubmittedContactMessage | null> {
  const existing = await client.contactMessage.findUnique({ where: { idempotencyKey }, select: { id: true, number: true, userId: true } });
  if (!existing) return null;
  if (existing.userId !== context.userId) throw new AppError("CONFLICT", "Ce message a déjà été envoyé.");
  return { id: existing.id, number: existing.number };
}

export type ContactRejectionReason = "honeypot" | "validation" | "rate_limited_ip" | "replay_conflict" | "internal";

/** Champs refusés par la validation : leurs noms seulement, jamais les valeurs saisies. */
function rejectedFields(error: AppError): string[] {
  const fieldErrors = (error.details as { fieldErrors?: Record<string, unknown> } | undefined)?.fieldErrors;
  return fieldErrors ? Object.keys(fieldErrors).sort() : [];
}

export function contactRejectionReason(error: unknown): ContactRejectionReason {
  if (!(error instanceof AppError)) return "internal";
  if (error.code === "VALIDATION") return rejectedFields(error).includes("website") ? "honeypot" : "validation";
  if (error.code === "RATE_LIMITED") return "rate_limited_ip";
  if (error.code === "CONFLICT") return "replay_conflict";
  return "internal";
}

/**
 * Trace technique d'un envoi refusé (journal, aucune écriture en base) : motif, champs en cause, réseau
 * d'origine (/24 ou /48). Ni nom, ni e-mail, ni téléphone, ni contenu : rien de ce que le visiteur a saisi.
 */
function logRejection(context: ContactContext, error: unknown): void {
  const reason = contactRejectionReason(error);
  const trace = {
    event: "contact_message.rejected",
    reason,
    network: ipNetwork(context.ip) ?? "inconnu",
    account: context.userId !== null,
    ...(reason === "validation" && error instanceof AppError ? { fields: rejectedFields(error) } : {}),
  };
  if (reason === "internal") {
    logger.error("Message de contact non enregistré (erreur interne)", { ...trace, errorName: error instanceof Error ? error.name : "NonErrorThrown" });
  } else {
    logger.warn("Message de contact refusé", trace);
  }
}

/**
 * Enregistre un message du formulaire de contact (compte ou invité), alerte le personnel et
 * accuse réception par e-mail si une adresse est donnée. Une double soumission renvoie le même message.
 * Chaque refus est tracé dans le journal technique (voir logRejection).
 */
export async function submitContactMessage(client: PrismaClient, context: ContactContext, input: unknown): Promise<SubmittedContactMessage> {
  try {
    return await acceptContactMessage(client, context, input);
  } catch (error) {
    logRejection(context, error);
    throw error;
  }
}

async function acceptContactMessage(client: PrismaClient, context: ContactContext, input: unknown): Promise<SubmittedContactMessage> {
  const message = parseInput(contactMessageSchema, input, "Message");
  const replay = await findReplay(client, message.idempotencyKey, context);
  if (replay) {
    logger.info("Message de contact déjà enregistré : double soumission rejouée", { event: "contact_message.replayed", network: ipNetwork(context.ip) ?? "inconnu" });
    return replay;
  }
  await assertAllowed(client, context.ip);

  let created: SubmittedContactMessage;
  try {
    created = await client.$transaction((tx) => createMessage(tx, context, message));
  } catch (error) {
    // Double soumission simultanée : la seconde bute sur la clé unique et rejoue la première.
    if (isUniqueViolation(error)) {
      const concurrent = await findReplay(client, message.idempotencyKey, context);
      if (concurrent) {
        logger.info("Message de contact déjà enregistré : double soumission simultanée", { event: "contact_message.replayed", network: ipNetwork(context.ip) ?? "inconnu" });
        return concurrent;
      }
    }
    throw error;
  }
  await dispatchNotifications(client, { contactMessageId: created.id });
  return created;
}

async function createMessage(tx: Prisma.TransactionClient, context: ContactContext, message: ContactMessageInput): Promise<SubmittedContactMessage> {
  // Compté avant la création : seuls les messages précédents de cette adresse entrent dans le plafond.
  const acknowledge = message.email !== null && (await acknowledgementAllowed(tx, message.email));
  const number = await nextBusinessNumber(tx, "contact_message", businessYear());
  const row = await tx.contactMessage.create({
    data: {
      number,
      idempotencyKey: message.idempotencyKey,
      userId: context.userId,
      name: message.name,
      email: message.email,
      phone: message.phone,
      subject: message.subject,
      reference: message.reference,
      message: message.message,
    },
    select: { id: true, number: true },
  });
  const data = { number, subject: CONTACT_SUBJECT_LABELS[message.subject] };
  const link = { contactMessageId: row.id };
  if (acknowledge) {
    await queueNotifications(tx, link, "contact.received", data, { email: message.email, phone: null });
  }
  const company = await getSetting("company", tx);
  await queueNotifications(tx, link, "contact.new_staff", data, { email: company.email, phone: null });
  await recordAudit(tx, {
    actorId: context.userId,
    action: "contact_message.create",
    entityType: "ContactMessage",
    entityId: row.id,
    ip: context.ip,
    after: { number, subject: message.subject },
  });
  return row;
}

/**
 * L'adresse saisie n'est pas vérifiée : au-delà du plafond quotidien, le message est enregistré sans accusé.
 * Chaque message avec e-mail reçoit un accusé tant que le plafond n'est pas atteint : compter les messages
 * de l'adresse (index email, createdAt) équivaut à compter les accusés, sans parcourir les notifications.
 */
async function acknowledgementAllowed(tx: Prisma.TransactionClient, email: string): Promise<boolean> {
  const since = new Date(Date.now() - DAY_MS);
  const previous = await tx.contactMessage.count({ where: { email, createdAt: { gte: since } } });
  return previous < CONTACT_LIMITS.acknowledgementsPerEmailPerDay;
}

/** Prise en charge, clôture ou réouverture d'un message (permission messages.manage). */
export async function changeContactMessageStatus(client: PrismaClient, actor: Actor, messageId: string, input: unknown): Promise<void> {
  await assertPermission(client, actor, "messages.manage");
  const { status } = parseInput(contactStatusSchema, input, "Statut du message");
  await client.$transaction(async (tx) => {
    const [locked] = await tx.$queryRaw<{ status: string }[]>`SELECT status FROM contact_messages WHERE id = ${messageId} FOR UPDATE`;
    if (!locked) throw new AppError("NOT_FOUND", "Message introuvable.");
    if (locked.status === status) throw new AppError("CONFLICT", status === "CLOSED" ? "Ce message est déjà traité." : "Ce message est déjà en cours.");
    await tx.contactMessage.update({ where: { id: messageId }, data: { status, closedAt: status === "CLOSED" ? new Date() : null } });
    await recordAudit(tx, {
      actorId: actor.id,
      action: "contact_message.status",
      entityType: "ContactMessage",
      entityId: messageId,
      before: { status: locked.status },
      after: { status },
    });
  });
}

/** Notes internes du personnel (jamais montrées à l'expéditeur). */
export async function saveContactMessageNotes(client: PrismaClient, actor: Actor, messageId: string, input: unknown): Promise<void> {
  await assertPermission(client, actor, "messages.manage");
  const { internalNotes } = parseInput(contactNotesSchema, input, "Notes");
  await client.$transaction(async (tx) => {
    const existing = await tx.contactMessage.findUnique({ where: { id: messageId }, select: { id: true } });
    if (!existing) throw new AppError("NOT_FOUND", "Message introuvable.");
    await tx.contactMessage.update({ where: { id: messageId }, data: { internalNotes } });
    await recordAudit(tx, { actorId: actor.id, action: "contact_message.notes", entityType: "ContactMessage", entityId: messageId });
  });
}
