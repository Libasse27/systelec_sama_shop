"use server";

import { db } from "@/server/db/client";
import { recordStockMovement, setAlertThreshold } from "@/server/modules/inventory/service";
import { adminAction } from "../_lib/action";
import { int, text } from "../_lib/form-data";
import type { ActionState } from "../_lib/form-state";

const MOVEMENT_MESSAGES = { IN: "Entrée enregistrée.", OUT: "Sortie enregistrée.", ADJUSTMENT: "Inventaire enregistré." } as const;

export async function recordMovementAction(variantId: string, _state: ActionState, formData: FormData): Promise<ActionState> {
  const type = text(formData, "type");
  const quantity = int(formData, "quantity");
  return adminAction(`/admin/stock/${variantId}`, async (actor) => {
    // Pour un inventaire, la quantité saisie est la quantité comptée (le service calcule l'écart).
    const input = type === "ADJUSTMENT" ? { type, variantId, countedQuantity: quantity } : { type, variantId, quantity };
    await recordStockMovement(db, actor, { ...input, reason: text(formData, "reason") });
    return MOVEMENT_MESSAGES[type as keyof typeof MOVEMENT_MESSAGES];
  });
}

export async function setThresholdAction(variantId: string, _state: ActionState, formData: FormData): Promise<ActionState> {
  return adminAction(`/admin/stock/${variantId}`, async (actor) => {
    await setAlertThreshold(db, actor, { variantId, alertThreshold: int(formData, "alertThreshold") });
    return "Seuil d'alerte enregistré.";
  });
}
