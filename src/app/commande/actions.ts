"use server";

import { revalidatePath } from "next/cache";
import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { getServerEnv } from "@/lib/env";
import { int, text } from "@/lib/form-data";
import type { ActionState } from "@/lib/form-state";
import { toActionState } from "@/server/action-state";
import { clientIp } from "@/server/auth/client-ip";
import { getCurrentUser } from "@/server/auth/session";
import { db } from "@/server/db/client";
import { readCartOwner } from "@/server/modules/cart/session";
import { placeOrder } from "@/server/modules/orders/checkout";

/** Choix « DELIVERY:<zone> » ou « PICKUP:<point> » (un seul groupe de boutons radio). */
function fulfillmentFrom(formData: FormData) {
  const [method, id] = (text(formData, "remise") ?? "").split(":");
  if (method === "PICKUP") return { method, pickupPointId: id };
  return {
    method,
    deliveryZoneId: id,
    address: {
      line1: text(formData, "line1"),
      district: text(formData, "district"),
      city: text(formData, "city"),
      landmark: text(formData, "landmark"),
    },
  };
}

export async function placeOrderAction(_state: ActionState, formData: FormData): Promise<ActionState> {
  let destination: string;
  try {
    const owner = await readCartOwner();
    if (!owner) return { error: "Votre panier est vide." };
    const user = await getCurrentUser();
    const order = await placeOrder(
      db,
      { userId: user?.id ?? null, cart: owner, ip: clientIp(await headers(), getServerEnv().TRUSTED_PROXY_HOPS) },
      {
        idempotencyKey: text(formData, "idempotencyKey"),
        contact: { name: text(formData, "name"), phone: text(formData, "phone"), email: text(formData, "email") },
        fulfillment: fulfillmentFrom(formData),
        notes: text(formData, "notes"),
        expectedSubtotal: int(formData, "expectedSubtotal"),
      },
    );
    destination = `/commande/${order.number}${order.accessToken ? `?jeton=${order.accessToken}` : ""}`;
  } catch (error) {
    // Prix ou stock changés : la page se réaffiche avec le récapitulatif à jour.
    revalidatePath("/commande");
    const state = toActionState(error);
    // Erreurs « fulfillment.address.line1 » → champ « line1 » du formulaire.
    const fieldErrors =
      state.fieldErrors &&
      Object.fromEntries(Object.entries(state.fieldErrors).map(([key, value]) => [key.replace(/^(contact|fulfillment\.address)\./, ""), value]));
    return { ...state, fieldErrors };
  }
  redirect(destination);
}
