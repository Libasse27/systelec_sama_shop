import "server-only";
import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { cache } from "react";
import type { UserKind } from "@/generated/prisma/client";
import type { Permission } from "@/server/authz/permissions";
import { assertPermission, loadAccess, type Actor } from "@/server/authz/service";
import { db } from "@/server/db/client";
import { AppError } from "@/server/errors";
import { getAuth } from "./auth";

export interface CurrentUser extends Actor {
  email: string;
  name: string;
  kind: UserKind;
}

/** Utilisateur de la requête courante (une seule lecture par requête), ou null. */
export const getCurrentUser = cache(async (): Promise<CurrentUser | null> => {
  const session = await getAuth().api.getSession({ headers: await headers() });
  if (!session) return null;
  const user = await db.user.findUnique({
    where: { id: session.user.id },
    select: { id: true, email: true, name: true, kind: true, isActive: true },
  });
  if (!user?.isActive) return null;
  const access = await loadAccess(db, user.id);
  return { id: user.id, email: user.email, name: user.name, kind: user.kind, ...access };
});

/** Exige une session ; sinon redirige vers la connexion puis revient sur `returnTo`. */
export async function requireUser(returnTo: string): Promise<CurrentUser> {
  const user = await getCurrentUser();
  if (!user) redirect(`/connexion?suivant=${encodeURIComponent(returnTo)}`);
  return user;
}

/** Exige une permission (refus journalisé) ; sinon redirige vers la page « accès refusé ». */
export async function requirePermission(permission: Permission, returnTo: string): Promise<CurrentUser> {
  const user = await requireUser(returnTo);
  try {
    await assertPermission(db, user, permission);
  } catch (error) {
    if (error instanceof AppError && error.code === "FORBIDDEN") redirect("/acces-refuse");
    throw error;
  }
  return user;
}

/** Exige l'une des permissions (la première est celle journalisée en cas de refus). */
export async function requireAnyPermission(permissions: readonly [Permission, ...Permission[]], returnTo: string): Promise<CurrentUser> {
  const user = await requireUser(returnTo);
  if (permissions.some((permission) => user.permissions.has(permission))) return user;
  return requirePermission(permissions[0], returnTo);
}
