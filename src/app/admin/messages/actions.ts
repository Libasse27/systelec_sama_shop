"use server";

import { db } from "@/server/db/client";
import { changeContactMessageStatus, saveContactMessageNotes } from "@/server/modules/contact/messages";
import type { ActionState } from "@/lib/form-state";
import { text } from "@/lib/form-data";
import { adminAction } from "../_lib/action";

export async function changeMessageStatusAction(messageId: string, _state: ActionState, formData: FormData): Promise<ActionState> {
  const status = text(formData, "status");
  return adminAction(`/admin/messages/${messageId}`, async (actor) => {
    await changeContactMessageStatus(db, actor, messageId, { status });
    return status === "CLOSED" ? "Message marqué comme traité." : "Message pris en charge.";
  });
}

export async function saveMessageNotesAction(messageId: string, _state: ActionState, formData: FormData): Promise<ActionState> {
  return adminAction(`/admin/messages/${messageId}`, async (actor) => {
    await saveContactMessageNotes(db, actor, messageId, { internalNotes: text(formData, "internalNotes") });
    return "Notes enregistrées.";
  });
}
