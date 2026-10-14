import "server-only";
import type { Db } from "@/server/db/client";
import { dispatchNotifications, queueNotifications, type NotificationRecipients } from "./queue";
import type { OrderMessageData, OrderTemplate } from "./templates";

export type OrderRecipients = NotificationRecipients;

/** Notifications d'une commande (voir queueNotifications). */
export function queueOrderNotifications(
  tx: Db,
  orderId: string,
  template: OrderTemplate,
  data: OrderMessageData,
  recipients: OrderRecipients,
): Promise<void> {
  return queueNotifications(tx, { orderId }, template, data, recipients);
}

/** Envoie les e-mails en attente d'une commande. Ne lève jamais. */
export function dispatchOrderNotifications(client: Db, orderId: string): Promise<void> {
  return dispatchNotifications(client, { orderId });
}
