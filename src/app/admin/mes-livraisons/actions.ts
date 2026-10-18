"use server";

import { db } from "@/server/db/client";
import { completeDelivery, failDelivery, startDelivery } from "@/server/modules/deliveries/service";
import { recordOrderPayment } from "@/server/modules/payments/service";
import type { ActionState } from "@/lib/form-state";
import { int, text } from "@/lib/form-data";
import { adminAction } from "../_lib/action";

const PATH = "/admin/mes-livraisons";

/** Actions du livreur interne sur SES livraisons (décision 5) : le service vérifie l'attribution sous verrou. */
export async function startMyDeliveryAction(orderId: string): Promise<ActionState> {
  return adminAction(PATH, async (actor) => {
    await startDelivery(db, actor, orderId);
    return "Départ enregistré.";
  });
}

export async function collectMyDeliveryAction(orderId: string, _state: ActionState, formData: FormData): Promise<ActionState> {
  return adminAction(PATH, async (actor) => {
    const { receiptNumber, replayed } = await recordOrderPayment(db, actor, orderId, { amount: int(formData, "amount"), idempotencyKey: text(formData, "idempotencyKey") });
    return replayed ? `Encaissement déjà enregistré (reçu ${receiptNumber}).` : `Espèces encaissées : reçu ${receiptNumber}.`;
  });
}

export async function completeMyDeliveryAction(orderId: string, _state: ActionState, formData: FormData): Promise<ActionState> {
  return adminAction(PATH, async (actor) => {
    await completeDelivery(db, actor, orderId, { recipientName: text(formData, "recipientName"), proofNote: text(formData, "proofNote") });
    return "Livraison effectuée.";
  });
}

export async function failMyDeliveryAction(orderId: string, _state: ActionState, formData: FormData): Promise<ActionState> {
  return adminAction(PATH, async (actor) => {
    await failDelivery(db, actor, orderId, { reason: text(formData, "reason") });
    return "Incident enregistré.";
  });
}
