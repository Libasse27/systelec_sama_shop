"use server";

import { db } from "@/server/db/client";
import { changeOrderStatus } from "@/server/modules/orders/status";
import { recordOrderPayment, voidPayment } from "@/server/modules/payments/service";
import type { ActionState } from "@/lib/form-state";
import { int, text } from "@/lib/form-data";
import { ORDER_STATUS_LABELS } from "@/lib/labels";
import { adminAction } from "../_lib/action";

export async function changeOrderStatusAction(orderId: string, _state: ActionState, formData: FormData): Promise<ActionState> {
  const status = text(formData, "status");
  return adminAction(`/admin/commandes/${orderId}`, async (actor) => {
    await changeOrderStatus(db, actor, orderId, { status, comment: text(formData, "comment") });
    return `Commande passée à « ${ORDER_STATUS_LABELS[status as keyof typeof ORDER_STATUS_LABELS]} ».`;
  });
}

export async function recordPaymentAction(orderId: string, _state: ActionState, formData: FormData): Promise<ActionState> {
  return adminAction(`/admin/commandes/${orderId}`, async (actor) => {
    const { receiptNumber, replayed } = await recordOrderPayment(db, actor, orderId, {
      amount: int(formData, "amount"),
      note: text(formData, "note"),
      idempotencyKey: text(formData, "idempotencyKey"),
    });
    return replayed ? `Encaissement déjà enregistré (reçu ${receiptNumber}).` : `Encaissement enregistré : reçu ${receiptNumber}.`;
  });
}

export async function voidPaymentAction(orderId: string, paymentId: string, _state: ActionState, formData: FormData): Promise<ActionState> {
  return adminAction(`/admin/commandes/${orderId}`, async (actor) => {
    const { receiptNumber } = await voidPayment(db, actor, paymentId, { reason: text(formData, "reason") });
    return `Encaissement annulé par la contre-écriture ${receiptNumber}.`;
  });
}
