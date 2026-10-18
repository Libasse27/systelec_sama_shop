"use server";

import { redirect } from "next/navigation";
import { db } from "@/server/db/client";
import { createDirectIntervention } from "@/server/modules/interventions/workflow";
import { createQuoteDraft } from "@/server/modules/quotes/quotes";
import { changeQuoteRequestStatus } from "@/server/modules/quotes/requests";
import type { ActionState } from "@/lib/form-state";
import { int, text } from "@/lib/form-data";
import { adminAction } from "../_lib/action";

export async function changeRequestStatusAction(requestId: string, _state: ActionState, formData: FormData): Promise<ActionState> {
  const status = text(formData, "status");
  return adminAction(`/admin/demandes/${requestId}`, async (actor) => {
    await changeQuoteRequestStatus(db, actor, requestId, { status, note: text(formData, "note") });
    return status === "CANCELLED" ? "Demande close sans suite." : "Demande prise en charge.";
  });
}

export async function createQuoteAction(requestId: string): Promise<ActionState> {
  let quoteId: string | undefined;
  const state = await adminAction(`/admin/demandes/${requestId}`, async (actor) => {
    quoteId = (await createQuoteDraft(db, actor, requestId)).id;
  });
  if (!quoteId) return state;
  redirect(`/admin/devis/${quoteId}`);
}

export async function createDirectInterventionAction(requestId: string, _state: ActionState, formData: FormData): Promise<ActionState> {
  let interventionId: string | undefined;
  const state = await adminAction(`/admin/demandes/${requestId}`, async (actor) => {
    interventionId = (await createDirectIntervention(db, actor, requestId, { amountDue: int(formData, "amountDue"), problem: text(formData, "problem") })).id;
  });
  if (!interventionId) return state;
  redirect(`/admin/interventions/${interventionId}`);
}
