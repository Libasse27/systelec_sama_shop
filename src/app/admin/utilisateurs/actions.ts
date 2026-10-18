"use server";

import { assignRole, revokeRole } from "@/server/authz/service";
import { db } from "@/server/db/client";
import { findRoleDefinition } from "@/server/authz/roles";
import { setUserActive } from "@/server/modules/users/service";
import type { ActionState } from "@/lib/form-state";
import { text } from "@/lib/form-data";
import { adminAction } from "../_lib/action";

const userPath = (userId: string) => `/admin/utilisateurs/${userId}`;
const roleLabel = (code: string | undefined) => (code ? (findRoleDefinition(code)?.label ?? code) : "");

export async function assignRoleAction(userId: string, _state: ActionState, formData: FormData): Promise<ActionState> {
  const role = text(formData, "role") ?? "";
  return adminAction(userPath(userId), async (actor) => {
    await assignRole(db, actor, userId, role);
    return `Rôle « ${roleLabel(role)} » attribué.`;
  });
}

/** Rôle choisi par le bouton ; droits, auto-rétrogradation et dernier administrateur revérifiés par le service. */
export async function revokeRoleAction(userId: string, _state: ActionState, formData: FormData): Promise<ActionState> {
  const role = text(formData, "role") ?? "";
  return adminAction(userPath(userId), async (actor) => {
    await revokeRole(db, actor, userId, role);
    return `Rôle « ${roleLabel(role)} » retiré.`;
  });
}

export async function setUserActiveAction(userId: string, _state: ActionState, formData: FormData): Promise<ActionState> {
  const active = text(formData, "active") === "true";
  return adminAction(userPath(userId), async (actor) => {
    await setUserActive(db, actor, userId, { active, reason: text(formData, "reason") });
    return active ? "Compte réactivé." : "Compte désactivé : ses sessions sont fermées.";
  });
}
