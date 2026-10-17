"use server";

import { db } from "@/server/db/client";
import { assignCourier, completeDelivery, failDelivery, startDelivery } from "@/server/modules/deliveries/service";
import { issueOrderInvoice } from "@/server/modules/invoices/service";
import { changeOrderStatus } from "@/server/modules/orders/status";
import { createReturn, decideReturn, refundReturn } from "@/server/modules/returns/service";
import type { ActionState } from "@/lib/form-state";
import { checkbox, int, text } from "@/lib/form-data";
import { ORDER_STATUS_LABELS } from "@/lib/labels";
import { adminAction } from "../_lib/action";

const orderPath = (orderId: string) => `/admin/commandes/${orderId}`;

export async function changeOrderStatusAction(orderId: string, _state: ActionState, formData: FormData): Promise<ActionState> {
  const status = text(formData, "status");
  return adminAction(orderPath(orderId), async (actor) => {
    await changeOrderStatus(db, actor, orderId, { status, comment: text(formData, "comment") });
    return `Commande passée à « ${ORDER_STATUS_LABELS[status as keyof typeof ORDER_STATUS_LABELS]} ».`;
  });
}

// ─── Livraison ───────────────────────────────────────────────────────────────

export async function assignCourierAction(orderId: string, _state: ActionState, formData: FormData): Promise<ActionState> {
  return adminAction(orderPath(orderId), async (actor) => {
    await assignCourier(db, actor, orderId, { courierId: text(formData, "courierId"), scheduledFor: text(formData, "scheduledFor"), note: text(formData, "note") });
    return "Livreur assigné.";
  });
}

export async function startDeliveryAction(orderId: string): Promise<ActionState> {
  return adminAction(orderPath(orderId), async (actor) => {
    await startDelivery(db, actor, orderId);
    return "Départ en livraison enregistré.";
  });
}

export async function completeDeliveryAction(orderId: string, _state: ActionState, formData: FormData): Promise<ActionState> {
  return adminAction(orderPath(orderId), async (actor) => {
    await completeDelivery(db, actor, orderId, { recipientName: text(formData, "recipientName"), proofNote: text(formData, "proofNote") });
    return "Livraison effectuée : commande remise au client.";
  });
}

export async function failDeliveryAction(orderId: string, _state: ActionState, formData: FormData): Promise<ActionState> {
  return adminAction(orderPath(orderId), async (actor) => {
    await failDelivery(db, actor, orderId, { reason: text(formData, "reason") });
    return "Échec de livraison enregistré.";
  });
}

// ─── Retours, remboursements, facture ───────────────────────────────────────

/** Quantités saisies par ligne (champs « qte-<ligne> ») ; les lignes vides valent 0. */
function returnedItems(formData: FormData): { orderItemId: string; quantity: number | undefined }[] {
  return [...formData.keys()]
    .filter((key) => key.startsWith("qte-"))
    .map((key) => ({ orderItemId: key.slice(4), quantity: int(formData, key) ?? 0 }));
}

export async function createReturnAction(orderId: string, _state: ActionState, formData: FormData): Promise<ActionState> {
  return adminAction(orderPath(orderId), async (actor) => {
    const { number, replayed } = await createReturn(db, actor, orderId, {
      idempotencyKey: text(formData, "idempotencyKey"),
      reason: text(formData, "reason"),
      items: returnedItems(formData),
    });
    return replayed ? `Retour déjà enregistré (${number}).` : `Retour ${number} enregistré : à vérifier.`;
  });
}

export async function decideReturnAction(orderId: string, returnId: string, _state: ActionState, formData: FormData): Promise<ActionState> {
  const decision = text(formData, "decision");
  return adminAction(orderPath(orderId), async (actor) => {
    await decideReturn(
      db,
      actor,
      returnId,
      decision === "REJECT"
        ? { decision, note: text(formData, "note") }
        : { decision, restock: checkbox(formData, "restock"), refundAmount: int(formData, "refundAmount"), note: text(formData, "note") },
    );
    return decision === "REJECT" ? "Retour refusé." : "Retour accepté.";
  });
}

export async function refundReturnAction(orderId: string, returnId: string, _state: ActionState, formData: FormData): Promise<ActionState> {
  return adminAction(orderPath(orderId), async (actor) => {
    const { receiptNumber, replayed } = await refundReturn(db, actor, returnId, { idempotencyKey: text(formData, "idempotencyKey"), note: text(formData, "note") });
    return replayed ? `Remboursement déjà enregistré (reçu ${receiptNumber}).` : `Remboursement versé : reçu ${receiptNumber}.`;
  });
}

export async function issueOrderInvoiceAction(orderId: string): Promise<ActionState> {
  return adminAction(orderPath(orderId), async (actor) => {
    const { number } = await issueOrderInvoice(db, actor, orderId);
    return `Facture ${number} émise.`;
  });
}
