"use server";

import { db } from "@/server/db/client";
import { saveCourier } from "@/server/modules/deliveries/service";
import { saveDeliveryZone, savePickupPoint } from "@/server/modules/orders/delivery-settings";
import { checkbox, int, optionalInt, text } from "@/lib/form-data";
import type { ActionState } from "@/lib/form-state";
import { adminAction } from "../_lib/action";

export async function saveZoneAction(id: string | null, _state: ActionState, formData: FormData): Promise<ActionState> {
  return adminAction("/admin/livraison", async (actor) => {
    await saveDeliveryZone(db, actor, id, {
      name: text(formData, "name"),
      description: text(formData, "description"),
      fee: int(formData, "fee"),
      freeAbove: optionalInt(formData, "freeAbove"),
      leadTimeText: text(formData, "leadTimeText"),
      position: int(formData, "position") ?? 0,
      isActive: checkbox(formData, "isActive"),
    });
    return id ? "Zone enregistrée." : "Zone créée.";
  });
}

export async function savePickupPointAction(id: string | null, _state: ActionState, formData: FormData): Promise<ActionState> {
  return adminAction("/admin/livraison", async (actor) => {
    await savePickupPoint(db, actor, id, {
      name: text(formData, "name"),
      address: text(formData, "address"),
      hours: text(formData, "hours"),
      phone: text(formData, "phone"),
      isActive: checkbox(formData, "isActive"),
    });
    return id ? "Point de retrait enregistré." : "Point de retrait créé.";
  });
}

export async function saveCourierAction(id: string | null, _state: ActionState, formData: FormData): Promise<ActionState> {
  return adminAction("/admin/livraison", async (actor) => {
    await saveCourier(db, actor, id, { name: text(formData, "name"), phone: text(formData, "phone"), isActive: checkbox(formData, "isActive") });
    return id ? "Livreur enregistré." : "Livreur ajouté.";
  });
}
