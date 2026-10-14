import "server-only";
import type { Prisma } from "@/generated/prisma/client";
import type { Db } from "@/server/db/client";
import { logger } from "@/server/logger";
import { sendEmail } from "./mailer";
import { renderOrderMessage, type OrderMessageData, type OrderTemplate } from "./templates";

export interface OrderRecipients {
  email: string | null;
  phone: string | null;
}

/**
 * Enregistre les notifications d'une commande dans la transaction qui la modifie.
 * E-mail : en attente d'envoi. SMS : aucun fournisseur (D11), tracé comme tel, jamais simulé.
 */
export async function queueOrderNotifications(
  tx: Db,
  orderId: string,
  template: OrderTemplate,
  data: OrderMessageData,
  recipients: OrderRecipients,
): Promise<void> {
  const payload = data as unknown as Prisma.InputJsonValue;
  const rows: Prisma.NotificationCreateManyInput[] = [];
  if (recipients.email) rows.push({ channel: "EMAIL", template, recipient: recipients.email, payload, orderId });
  if (recipients.phone) {
    rows.push({ channel: "SMS", template, recipient: recipients.phone, payload, orderId, status: "SKIPPED_NO_PROVIDER" });
  }
  if (rows.length > 0) await tx.notification.createMany({ data: rows });
}

/** Envoie les e-mails en attente d'une commande (après validation de la transaction). Ne lève jamais. */
export async function dispatchOrderNotifications(client: Db, orderId: string): Promise<void> {
  const pending = await client.notification.findMany({ where: { orderId, status: "PENDING", channel: "EMAIL", sentAt: null } });
  for (const notification of pending) {
    // Réservation de la ligne (sentAt posé) : deux envois simultanés n'expédient pas deux fois.
    const claimed = await client.notification.updateMany({
      where: { id: notification.id, status: "PENDING", sentAt: null },
      data: { sentAt: new Date() },
    });
    if (claimed.count !== 1) continue;
    try {
      const message = renderOrderMessage(notification.template as OrderTemplate, notification.payload as unknown as OrderMessageData);
      const result = await sendEmail({ to: notification.recipient, ...message });
      await client.notification.update({
        where: { id: notification.id },
        data: result.sent ? { status: "SENT", sentAt: new Date() } : { status: "SKIPPED_NO_PROVIDER", sentAt: null },
      });
    } catch (error) {
      const reason = error instanceof Error ? error.message : "inconnue";
      logger.error("Notification de commande non envoyée", { notificationId: notification.id, error: reason });
      await client.notification
        .update({ where: { id: notification.id }, data: { status: "FAILED", error: reason.slice(0, 500), sentAt: null } })
        .catch(() => undefined);
    }
  }
}
