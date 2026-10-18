"use server";

import { db } from "@/server/db/client";
import { answerReturnVerification, decideReturn, refundReturn, requestReturnVerification } from "@/server/modules/returns/service";
import type { ActionState } from "@/lib/form-state";
import { checkbox, int, text } from "@/lib/form-data";
import { adminAction } from "../_lib/action";

const returnPath = (returnId: string) => `/admin/retours/${returnId}`;

export async function requestVerificationAction(returnId: string, _state: ActionState, formData: FormData): Promise<ActionState> {
  return adminAction(returnPath(returnId), async (actor) => {
    await requestReturnVerification(db, actor, returnId, { kind: text(formData, "kind"), request: text(formData, "request") });
    return "Vérification demandée.";
  });
}

export async function answerVerificationAction(returnId: string, _state: ActionState, formData: FormData): Promise<ActionState> {
  return adminAction(returnPath(returnId), async (actor) => {
    await answerReturnVerification(db, actor, returnId, { response: text(formData, "response") });
    return "Réponse à la vérification enregistrée.";
  });
}

export async function decideReturnAction(returnId: string, _state: ActionState, formData: FormData): Promise<ActionState> {
  const decision = text(formData, "decision");
  return adminAction(returnPath(returnId), async (actor) => {
    await decideReturn(
      db,
      actor,
      returnId,
      decision === "REJECT"
        ? { decision, note: text(formData, "note") }
        : {
            decision,
            restock: checkbox(formData, "restock"),
            refundAmount: int(formData, "refundAmount"),
            note: text(formData, "note"),
            exceptionGround: text(formData, "exceptionGround"),
            exceptionNote: text(formData, "exceptionNote"),
          },
    );
    return decision === "REJECT" ? "Retour refusé." : "Retour accepté.";
  });
}

export async function refundReturnAction(returnId: string, _state: ActionState, formData: FormData): Promise<ActionState> {
  return adminAction(returnPath(returnId), async (actor) => {
    const { receiptNumber, replayed } = await refundReturn(db, actor, returnId, { idempotencyKey: text(formData, "idempotencyKey"), note: text(formData, "note") });
    return replayed ? `Remboursement déjà enregistré (reçu ${receiptNumber}).` : `Remboursement versé : reçu ${receiptNumber}.`;
  });
}
