"use server";

import { db } from "@/server/db/client";
import { recordPayment, voidPayment } from "@/server/modules/payments/service";
import type { PaymentTarget } from "@/server/modules/payments/targets";
import type { ActionState } from "@/lib/form-state";
import { int, text } from "@/lib/form-data";
import { adminAction } from "./action";

const pathOf = (target: PaymentTarget) => `/admin/${target.kind === "order" ? "commandes" : "interventions"}/${target.id}`;

export async function recordPaymentAction(target: PaymentTarget, _state: ActionState, formData: FormData): Promise<ActionState> {
  return adminAction(pathOf(target), async (actor) => {
    const { receiptNumber, replayed } = await recordPayment(db, actor, target, {
      amount: int(formData, "amount"),
      note: text(formData, "note"),
      idempotencyKey: text(formData, "idempotencyKey"),
    });
    return replayed ? `Encaissement déjà enregistré (reçu ${receiptNumber}).` : `Encaissement enregistré : reçu ${receiptNumber}.`;
  });
}

export async function voidPaymentAction(target: PaymentTarget, paymentId: string, _state: ActionState, formData: FormData): Promise<ActionState> {
  return adminAction(pathOf(target), async (actor) => {
    const { receiptNumber } = await voidPayment(db, actor, paymentId, { reason: text(formData, "reason") });
    return `Encaissement annulé par la contre-écriture ${receiptNumber}.`;
  });
}
