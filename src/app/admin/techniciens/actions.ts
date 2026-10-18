"use server";

import { db } from "@/server/db/client";
import { saveTechnicianProfile } from "@/server/modules/technicians/service";
import type { ActionState } from "@/lib/form-state";
import { checkbox, text } from "@/lib/form-data";
import { adminAction } from "../_lib/action";

export async function saveTechnicianAction(userId: string, _state: ActionState, formData: FormData): Promise<ActionState> {
  return adminAction("/admin/techniciens", async (actor) => {
    await saveTechnicianProfile(db, actor, userId, { skills: text(formData, "skills"), zones: text(formData, "zones"), isActive: checkbox(formData, "isActive") });
    return "Profil enregistré.";
  });
}
