import "server-only";
import type { Prisma } from "@/generated/prisma/client";
import type { Db } from "@/server/db/client";
import { logger } from "@/server/logger";
import { sendEmail } from "./mailer";
import { renderServiceMessage, SERVICE_TEMPLATES, type ServiceMessageData, type ServiceTemplate } from "./service-templates";
import { renderOrderMessage, type OrderMessageData, type OrderTemplate } from "./templates";

/** Document auquel une notification est rattachée (suivi dans sa fiche). */
export type NotificationLink = { orderId: string } | { quoteRequestId: string } | { quoteId: string } | { interventionId: string };

export type NotificationTemplate = OrderTemplate | ServiceTemplate;

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
  data: OrderMessageData | ServiceMessageData,
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
  if ((SERVICE_TEMPLATES as readonly string[]).includes(template)) {
    return renderServiceMessage(template as ServiceTemplate, payload as ServiceMessageData);
  }
  return renderOrderMessage(template as OrderTemplate, payload as OrderMessageData);
}

/** Envoie les e-mails en attente d'un document (après validation de la transaction). Ne lève jamais. */
export async function dispatchNotifications(client: Db, link: NotificationLink): Promise<void> {
  try {
    const pending = await client.notification.findMany({ where: { ...link, status: "PENDING", channel: "EMAIL", sentAt: null } });
    for (const notification of pending) await sendOne(client, notification);
  } catch (error) {
    logger.error("Notifications non envoyées", { ...link, error: error instanceof Error ? error.message : "inconnue" });
  }
}

async function sendOne(client: Db, notification: { id: string; template: string; recipient: string; payload: Prisma.JsonValue }): Promise<void> {
  // Réservation de la ligne (sentAt posé) : deux envois simultanés n'expédient pas deux fois.
  const claimed = await client.notification.updateMany({
    where: { id: notification.id, status: "PENDING", sentAt: null },
    data: { sentAt: new Date() },
  });
  if (claimed.count !== 1) return;
  try {
    const message = renderMessage(notification.template, notification.payload);
    const result = await sendEmail({ to: notification.recipient, ...message });
    await client.notification.update({
      where: { id: notification.id },
      data: result.sent ? { status: "SENT", sentAt: new Date() } : { status: "SKIPPED_NO_PROVIDER", sentAt: null },
    });
  } catch (error) {
    const reason = error instanceof Error ? error.message : "inconnue";
    logger.error("Notification non envoyée", { notificationId: notification.id, error: reason });
    await client.notification
      .update({ where: { id: notification.id }, data: { status: "FAILED", error: reason.slice(0, 500), sentAt: null } })
      .catch(() => undefined);
  }
}
