"use server";

import { revalidatePath } from "next/cache";
import { headers } from "next/headers";
import { randomUUID } from "node:crypto";
import { getServerEnv } from "@/lib/env";
import { int, text } from "@/lib/form-data";
import type { ActionState } from "@/lib/form-state";
import { toActionState } from "@/server/action-state";
import { clientIp } from "@/server/auth/client-ip";
import { getCurrentUser } from "@/server/auth/session";
import { db } from "@/server/db/client";
import { ValidationError } from "@/server/errors";
import { answerCustomerVerification, declareCustomerReturn, type CustomerContext } from "@/server/modules/returns/customer";
import { RETURN_PHOTO_LIMITS } from "@/server/storage/return-photos";
import { getStorage } from "@/server/storage/storage";

/**
 * Retours déclarés par le client (phase 10, décision 2). Accès : le jeton du lien de suivi s'il est
 * fourni (commande invitée), sinon le compte connecté. Le service vérifie que la commande lui appartient.
 */
async function customerContext(token: string | null): Promise<CustomerContext | null> {
  const ip = clientIp(await headers(), getServerEnv().TRUSTED_PROXY_HOPS);
  if (token) return { access: { userId: null, token }, ip };
  const user = await getCurrentUser();
  return user ? { access: { userId: user.id }, ip } : null;
}

/**
 * Photos envoyées, lues seulement quand le service le demande (après les contrôles d'accès et de
 * limites) ; une photo trop lourde est refusée sans être lue en mémoire.
 */
const photosOf = (formData: FormData) => async (): Promise<Uint8Array[]> => {
  const files = formData.getAll("photos").filter((entry): entry is File => entry instanceof File && entry.size > 0);
  if (files.some((file) => file.size > RETURN_PHOTO_LIMITS.maxBytes)) {
    throw new ValidationError("Photo trop lourde.", { fieldErrors: { photos: ["2 Mo au plus par photo"] } });
  }
  if (files.length > RETURN_PHOTO_LIMITS.perUpload) {
    throw new ValidationError("Trop de photos.", { fieldErrors: { photos: [`${RETURN_PHOTO_LIMITS.perUpload} photos au plus`] } });
  }
  return Promise.all(files.map(async (file) => new Uint8Array(await file.arrayBuffer())));
};

/** Le suivi d'une commande s'affiche dans « Mon compte » et sur la page de suivi : les deux sont rafraîchies. */
function refreshOrderPages(orderNumber: string): void {
  revalidatePath(`/commande/${orderNumber}`);
  revalidatePath(`/compte/commandes/${orderNumber}`);
}

export async function declareReturnAction(orderNumber: string, token: string | null, _state: ActionState, formData: FormData): Promise<ActionState> {
  try {
    const context = await customerContext(token);
    if (!context) return { error: "Connectez-vous pour déclarer un retour." };
    const items = formData
      .getAll("orderItemId")
      .map(String)
      .map((orderItemId) => ({ orderItemId, quantity: int(formData, `quantity-${orderItemId}`) ?? 0 }));
    const created = await declareCustomerReturn(
      db,
      getStorage(),
      context,
      orderNumber,
      { idempotencyKey: text(formData, "idempotencyKey") ?? randomUUID(), category: text(formData, "category"), description: text(formData, "description"), items },
      photosOf(formData),
    );
    refreshOrderPages(orderNumber);
    return {
      success: `Demande de retour ${created.number} enregistrée${created.lateDeclaration ? " (après le délai de 48 heures : elle sera examinée au cas par cas)" : ""}. Nous l'examinons et revenons vers vous.`,
      doneAt: Date.now(),
    };
  } catch (error) {
    return toActionState(error);
  }
}

export async function answerReturnAction(orderNumber: string, returnNumber: string, token: string | null, _state: ActionState, formData: FormData): Promise<ActionState> {
  try {
    const context = await customerContext(token);
    if (!context) return { error: "Connectez-vous pour répondre." };
    await answerCustomerVerification(db, getStorage(), context, orderNumber, returnNumber, { response: text(formData, "response") }, photosOf(formData));
    refreshOrderPages(orderNumber);
    return { success: "Réponse envoyée. Nous reprenons l'examen de votre demande.", doneAt: Date.now() };
  } catch (error) {
    return toActionState(error);
  }
}
