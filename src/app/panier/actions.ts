"use server";

import { revalidatePath } from "next/cache";
import { int, text } from "@/lib/form-data";
import type { ActionState } from "@/lib/form-state";
import { toActionState } from "@/server/action-state";
import { db } from "@/server/db/client";
import { addToCart, setCartQuantity } from "@/server/modules/cart/service";
import { ensureCartOwner, readCartOwner } from "@/server/modules/cart/session";

async function run(task: () => Promise<string>): Promise<ActionState> {
  try {
    const success = await task();
    revalidatePath("/", "layout");
    return { success, doneAt: Date.now() };
  } catch (error) {
    return toActionState(error);
  }
}

export async function addToCartAction(_state: ActionState, formData: FormData): Promise<ActionState> {
  return run(async () => {
    const { quantity } = await addToCart(db, await ensureCartOwner(), { sku: text(formData, "sku"), quantity: int(formData, "quantity") ?? 1 });
    return `Ajouté au panier (${quantity} dans votre panier).`;
  });
}

export async function updateCartLineAction(variantId: string, _state: ActionState, formData: FormData): Promise<ActionState> {
  return run(async () => {
    const owner = await readCartOwner();
    if (owner) await setCartQuantity(db, owner, { variantId, quantity: int(formData, "quantity") });
    return "Quantité mise à jour.";
  });
}

export async function removeCartLineAction(variantId: string): Promise<ActionState> {
  return run(async () => {
    const owner = await readCartOwner();
    if (owner) await setCartQuantity(db, owner, { variantId, quantity: 0 });
    return "Article retiré du panier.";
  });
}
