"use server";

import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { getServerEnv } from "@/lib/env";
import { checkbox, text } from "@/lib/form-data";
import type { ActionState } from "@/lib/form-state";
import { toActionState } from "@/server/action-state";
import { clientIp } from "@/server/auth/client-ip";
import { getCurrentUser } from "@/server/auth/session";
import { db } from "@/server/db/client";
import { decideQuote } from "@/server/modules/quotes/quotes";
import { submitQuoteRequest } from "@/server/modules/quotes/requests";

export async function submitQuoteRequestAction(_state: ActionState, formData: FormData): Promise<ActionState> {
  let destination: string;
  try {
    const user = await getCurrentUser();
    const request = await submitQuoteRequest(
      db,
      { userId: user?.id ?? null, ip: clientIp(await headers(), getServerEnv().TRUSTED_PROXY_HOPS) },
      {
        idempotencyKey: text(formData, "idempotencyKey"),
        contact: { name: text(formData, "name"), phone: text(formData, "phone"), email: text(formData, "email") },
        serviceSlug: text(formData, "service"),
        address: text(formData, "address"),
        description: text(formData, "description"),
        urgency: checkbox(formData, "urgent") ? "URGENT" : "NORMAL",
        availability: text(formData, "availability"),
      },
    );
    destination = `/devis/demande/${request.number}${request.accessToken ? `?jeton=${request.accessToken}` : ""}`;
  } catch (error) {
    const state = toActionState(error);
    // Erreurs « contact.phone » → champ « phone » du formulaire.
    const fieldErrors = state.fieldErrors && Object.fromEntries(Object.entries(state.fieldErrors).map(([key, value]) => [key.replace(/^contact\./, ""), value]));
    return { ...state, fieldErrors };
  }
  redirect(destination);
}

/** Réponse du client à son devis (compte connecté, ou invité avec le jeton de son lien). */
export async function decideQuoteAction(quoteId: string, number: string, token: string | null, _state: ActionState, formData: FormData): Promise<ActionState> {
  const accept = text(formData, "decision") === "accept";
  try {
    const user = await getCurrentUser();
    const decider = token ? ({ kind: "guest", token } as const) : user ? ({ kind: "customer", userId: user.id } as const) : null;
    if (!decider) return { error: "Connectez-vous pour répondre à ce devis." };
    await decideQuote(db, decider, quoteId, { accept, note: text(formData, "note") });
  } catch (error) {
    return toActionState(error);
  }
  redirect(`/devis/${number}?${new URLSearchParams({ ...(token ? { jeton: token } : {}), reponse: accept ? "acceptee" : "refusee" })}`);
}
