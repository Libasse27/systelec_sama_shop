"use server";

import { redirect } from "next/navigation";
import { db } from "@/server/db/client";
import { decideQuote, saveQuoteDraft, sendQuote } from "@/server/modules/quotes/quotes";
import type { ActionState } from "@/lib/form-state";
import { int, text } from "@/lib/form-data";
import { adminAction } from "../_lib/action";

/** Nombre de lignes du formulaire (lignes existantes + lignes vides), plafonné côté serveur par le schéma. */
const MAX_FORM_ROWS = 60;

/** Lignes saisies ; une ligne entièrement vide est ignorée, une ligne incomplète est signalée par la validation. */
function itemsFrom(formData: FormData) {
  const rows = Math.min(int(formData, "rows") ?? 0, MAX_FORM_ROWS);
  return Array.from({ length: rows }, (_, index) => ({
    kind: text(formData, `items.${index}.kind`),
    label: text(formData, `items.${index}.label`)?.trim() ?? "",
    quantity: int(formData, `items.${index}.quantity`),
    unitPrice: int(formData, `items.${index}.unitPrice`),
  })).filter((item) => item.label !== "" || item.quantity !== undefined || item.unitPrice !== undefined);
}

const FIELD_NAMES: Record<string, string> = { kind: "type", label: "désignation", quantity: "quantité", unitPrice: "prix unitaire" };

/** Les cellules du tableau n'affichent pas d'erreur : elles sont résumées dans le message (« Ligne 2, quantité : … »). */
function withLineErrors(state: ActionState): ActionState {
  const lines = Object.entries(state.fieldErrors ?? {}).flatMap(([key, messages]) => {
    const match = /^items\.(\d+)\.(\w+)$/.exec(key);
    return match ? [`Ligne ${Number(match[1]) + 1}, ${FIELD_NAMES[match[2]!] ?? match[2]} : ${(messages ?? []).join(", ")}`] : [];
  });
  return lines.length > 0 ? { ...state, error: `Vérifiez les lignes du devis. ${lines.join(" · ")}` } : state;
}

export async function saveQuoteAction(quoteId: string, _state: ActionState, formData: FormData): Promise<ActionState> {
  const send = text(formData, "intent") === "send";
  let sent = false;
  const state = await adminAction(`/admin/devis/${quoteId}`, async (actor) => {
    await saveQuoteDraft(db, actor, quoteId, { validUntil: text(formData, "validUntil"), notes: text(formData, "notes"), items: itemsFrom(formData) });
    if (!send) return "Brouillon enregistré.";
    await sendQuote(db, actor, quoteId);
    sent = true;
  });
  // Envoyé : l'éditeur laisse place au récapitulatif, qui affiche la confirmation.
  if (sent) redirect(`/admin/devis/${quoteId}?envoye=1`);
  return withLineErrors(state);
}

/** Réponse transmise par le client hors ligne (téléphone, visite). */
export async function decideQuoteForCustomerAction(quoteId: string, _state: ActionState, formData: FormData): Promise<ActionState> {
  const accept = text(formData, "decision") === "accept";
  return adminAction(`/admin/devis/${quoteId}`, async (actor) => {
    const { interventionNumber } = await decideQuote(db, { kind: "staff", actor }, quoteId, { accept, note: text(formData, "note") });
    return accept ? `Devis accepté : intervention ${interventionNumber} à planifier.` : "Refus du client enregistré.";
  });
}
