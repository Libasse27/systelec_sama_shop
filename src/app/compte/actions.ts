"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import type { ActionState } from "@/lib/form-state";
import { toActionState } from "@/server/action-state";
import { requireUser } from "@/server/auth/session";
import { db } from "@/server/db/client";
import { cancelOwnOrder } from "@/server/modules/orders/status";

export async function cancelOwnOrderAction(number: string): Promise<ActionState> {
  const user = await requireUser(`/compte/commandes/${number}`);
  try {
    await cancelOwnOrder(db, user.id, number);
  } catch (error) {
    return toActionState(error);
  }
  revalidatePath("/compte", "layout");
  // Le bouton disparaît avec la commande annulée : la confirmation est affichée par la page.
  redirect(`/compte/commandes/${number}?annulee=1`);
}
