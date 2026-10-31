import "server-only";
import type { Prisma } from "@/generated/prisma/client";
import type { Db } from "@/server/db/client";
import { logger } from "@/server/logger";
import { CONTACT_TEMPLATES, renderContactMessage, type ContactMessageData, type ContactTemplate } from "./contact-templates";
import { classifyNotificationFailure, sendEmail } from "./mailer";
import { renderReturnMessage, RETURN_TEMPLATES, type ReturnMessageData, type ReturnTemplate } from "./return-templates";
import { renderServiceMessage, SERVICE_TEMPLATES, type ServiceMessageData, type ServiceTemplate } from "./service-templates";
import { renderOrderMessage, type OrderMessageData, type OrderTemplate } from "./templates";

/** Document auquel une notification est rattachée (suivi dans sa fiche). */
export type NotificationLink = { orderId: string } | { quoteRequestId: string } | { quoteId: string } | { interventionId: string } | { returnId: string } | { contactMessageId: string };

export type NotificationTemplate = OrderTemplate | ServiceTemplate | ReturnTemplate | ContactTemplate;

export interface NotificationRecipients {
  email: string | null;
  phone: string | null;
}

/**
 * Enregistre les notifications dans la transaction qui modifie le document.
 * E-mail : en attente d'envoi. SMS : aucun fournisseur (D11), tracé comme tel, jamais simulé.
 */
export async function queueNotifications(
  tx: Db,
  link: NotificationLink,
  template: NotificationTemplate,
  data: OrderMessageData | ServiceMessageData | ReturnMessageData | ContactMessageData,
  recipients: NotificationRecipients,
): Promise<void> {
  const payload = data as unknown as Prisma.InputJsonValue;
  const rows: Prisma.NotificationCreateManyInput[] = [];
  if (recipients.email) rows.push({ channel: "EMAIL", template, recipient: recipients.email, payload, ...link });
  if (recipients.phone) {
    rows.push({ channel: "SMS", template, recipient: recipients.phone, payload, ...link, status: "SKIPPED_NO_PROVIDER" });
  }
  if (rows.length > 0) await tx.notification.createMany({ data: rows });
}

function renderMessage(template: string, payload: unknown): { subject: string; text: string } {
  if ((CONTACT_TEMPLATES as readonly string[]).includes(template)) {
    return renderContactMessage(template as ContactTemplate, payload as ContactMessageData);
  }
  if ((RETURN_TEMPLATES as readonly string[]).includes(template)) {
    return renderReturnMessage(template as ReturnTemplate, payload as ReturnMessageData);
  }
  if ((SERVICE_TEMPLATES as readonly string[]).includes(template)) {
    return renderServiceMessage(template as ServiceTemplate, payload as ServiceMessageData);
  }
  return renderOrderMessage(template as OrderTemplate, payload as OrderMessageData);
}

/** Délais avant chaque nouvel essai d'un e-mail en échec : 4 envois au plus (1 + 3 renvois). */
export const RETRY_DELAYS_MINUTES = [15, 60, 240] as const;
export const MAX_EMAIL_ATTEMPTS = RETRY_DELAYS_MINUTES.length + 1;
/** Notifications traitées au plus par passage de la tâche planifiée (durée bornée). */
const RETRY_BATCH_SIZE = 50;
/** Une notification restée en attente au-delà de ce délai est rattrapée (envoi jamais fait ou interrompu). */
const ORPHAN_AFTER_MINUTES = 10;
/** …mais pas au-delà de 24 heures : un message périmé n'est pas expédié après coup. */
const ORPHAN_MAX_AGE_MINUTES = 24 * 60;
/** Refus définitifs du serveur destinataire (boîte inexistante, adresse invalide) : jamais renvoyés. */
const PERMANENT_SMTP_CODES = new Set([550, 551, 553]);
const MINUTE_MS = 60_000;

/** Diagnostics internes limités aux noms de type et frames de code, sans message d'exception. */
function internalDiagnostic(error: unknown): Record<string, unknown> {
  if (!(error instanceof Error)) return { errorName: "NonErrorThrown" };

  const knownErrorNames = new Set(["Error", "TypeError", "RangeError", "ReferenceError", "SyntaxError", "URIError", "EvalError", "AggregateError"]);
  const errorName = knownErrorNames.has(error.name) ? error.name : "ApplicationError";
  const stackFrames = (error.stack ?? "")
    .split("\n")
    .slice(1)
    .flatMap((line) => {
      const match = /^\s*at (?:(.*?) \()?(.+?):(\d+):(\d+)\)?$/.exec(line);
      if (!match) return [];
      const functionName = (match[1] ?? "anonymous").replace(/[^A-Za-z0-9_.$<>]/g, "").slice(0, 80) || "anonymous";
      const fileName = match[2]!.split(/[\\/]/).at(-1)!.replace(/[^A-Za-z0-9_.-]/g, "").slice(0, 100);
      if (!fileName) return [];
      return [`${functionName} (${fileName}:${match[3]}:${match[4]})`];
    })
    .slice(0, 8);

  return { errorName, ...(stackFrames.length > 0 ? { stackFrames } : {}) };
}

interface SendableNotification {
  id: string;
  template: string;
  recipient: string;
  payload: Prisma.JsonValue;
  attempts: number;
}

/** Envoie les e-mails en attente d'un document (après validation de la transaction). Ne lève jamais. */
export async function dispatchNotifications(client: Db, link: NotificationLink): Promise<void> {
  try {
    const pending = await client.notification.findMany({ where: { ...link, status: "PENDING", channel: "EMAIL", sentAt: null } });
    for (const notification of pending) await sendOne(client, notification);
  } catch (error) {
    const failure = classifyNotificationFailure(error);
    logger.error("Notifications non envoyées", {
      ...link,
      failureCode: failure.failureCode,
      ...(failure.category === "INTERNAL" ? internalDiagnostic(error) : {}),
    });
  }
}

const isPermanentFailure = (error: unknown): boolean => {
  const code = (error as { responseCode?: unknown } | null)?.responseCode;
  return typeof code === "number" && PERMANENT_SMTP_CODES.has(code);
};

/** Prochain essai après l'envoi numéro `attempts` en échec, ou null (refus définitif, essais épuisés). */
export function nextAttemptAfter(attempts: number, error: unknown, now: Date): Date | null {
  if (isPermanentFailure(error) || attempts >= MAX_EMAIL_ATTEMPTS) return null;
  const delay = RETRY_DELAYS_MINUTES[Math.max(0, attempts - 1)]!;
  return new Date(now.getTime() + delay * MINUTE_MS);
}

async function sendOne(client: Db, notification: SendableNotification): Promise<"SENT" | "FAILED" | "SKIPPED" | "TAKEN"> {
  // Réservation de la ligne (sentAt posé) : deux envois simultanés n'expédient pas deux fois.
  const claimed = await client.notification.updateMany({
    where: { id: notification.id, status: "PENDING", sentAt: null },
    data: { sentAt: new Date(), attempts: { increment: 1 } },
  });
  if (claimed.count !== 1) return "TAKEN";
  const attempts = notification.attempts + 1;
  try {
    const message = renderMessage(notification.template, notification.payload);
    const result = await sendEmail({ to: notification.recipient, ...message });
    await client.notification.update({
      where: { id: notification.id },
      data: result.sent ? { status: "SENT", sentAt: new Date(), error: null } : { status: "SKIPPED_NO_PROVIDER", sentAt: null },
    });
    return result.sent ? "SENT" : "SKIPPED";
  } catch (error) {
    const safeFailure = classifyNotificationFailure(error);
    const nextAttemptAt = nextAttemptAfter(attempts, safeFailure, new Date());
    logger.error("Notification non envoyée", {
      notificationId: notification.id,
      attempts,
      retry: nextAttemptAt?.toISOString() ?? "aucun",
      failureCode: safeFailure.failureCode,
      ...(safeFailure.category === "INTERNAL" ? internalDiagnostic(error) : {}),
    });
    await client.notification
      .update({ where: { id: notification.id }, data: { status: "FAILED", error: safeFailure.failureCode, sentAt: null, nextAttemptAt } })
      .catch(() => undefined);
    return "FAILED";
  }
}

export interface RetryReport {
  sent: number;
  failed: number;
  skipped: number;
}

type DueNotification = SendableNotification & { status: string; sentAt: Date | null };

/**
 * Remet en attente d'envoi une notification due, par une mise à jour conditionnelle sur l'état lu :
 * si un autre passage l'a déjà prise ou modifiée, rien n'est fait (false).
 *  - échec arrivé à échéance : redevient PENDING ;
 *  - réservation abandonnée (processus arrêté pendant l'envoi) : réservation levée ;
 *  - attente jamais réservée : rien à lever, la réservation de sendOne départage.
 */
async function release(client: Db, notification: DueNotification, now: Date): Promise<boolean> {
  if (notification.status === "FAILED") {
    const reopened = await client.notification.updateMany({
      where: { id: notification.id, status: "FAILED", nextAttemptAt: { lte: now } },
      data: { status: "PENDING", nextAttemptAt: null },
    });
    return reopened.count === 1;
  }
  if (notification.sentAt === null) return true;
  const unclaimed = await client.notification.updateMany({
    where: { id: notification.id, status: "PENDING", sentAt: notification.sentAt },
    data: { sentAt: null },
  });
  return unclaimed.count === 1;
}

/** Envois épuisés (réservation abandonnée au 4e envoi) : échec définitif, jamais de 5e envoi. */
async function abandon(client: Db, notification: DueNotification): Promise<boolean> {
  const closed = await client.notification.updateMany({
    where: { id: notification.id, status: notification.status as "PENDING" | "FAILED", sentAt: notification.sentAt },
    data: { status: "FAILED", sentAt: null, nextAttemptAt: null, error: "ABANDONED" },
  });
  return closed.count === 1;
}

/**
 * Tâche planifiée : renvoie les e-mails en échec dont l'heure de nouvel essai est passée, et rattrape
 * ceux restés en attente (jamais envoyés, ou réservés par un processus arrêté pendant l'envoi) entre
 * 10 minutes et 24 heures après leur création. Une réservation abandonnée a pu être expédiée avant
 * l'arrêt : le rattrapage garantit « au moins un envoi », jamais plus de MAX_EMAIL_ATTEMPTS.
 */
export async function retryNotifications(client: Db, now: Date = new Date()): Promise<RetryReport> {
  const report: RetryReport = { sent: 0, failed: 0, skipped: 0 };
  const stale = new Date(now.getTime() - ORPHAN_AFTER_MINUTES * MINUTE_MS);
  const due = await client.notification.findMany({
    where: {
      channel: "EMAIL",
      OR: [
        { status: "FAILED", nextAttemptAt: { lte: now } },
        {
          status: "PENDING",
          createdAt: { gte: new Date(now.getTime() - ORPHAN_MAX_AGE_MINUTES * MINUTE_MS) },
          OR: [{ sentAt: null, createdAt: { lte: stale } }, { sentAt: { lte: stale } }],
        },
      ],
    },
    orderBy: { createdAt: "asc" },
    take: RETRY_BATCH_SIZE,
  });
  for (const notification of due) {
    if (notification.attempts >= MAX_EMAIL_ATTEMPTS) {
      if (await abandon(client, notification)) report.failed += 1;
      continue;
    }
    if (!(await release(client, notification, now))) continue;
    const outcome = await sendOne(client, notification);
    if (outcome === "SENT") report.sent += 1;
    else if (outcome === "FAILED") report.failed += 1;
    else if (outcome === "SKIPPED") report.skipped += 1;
  }
  return report;
}
