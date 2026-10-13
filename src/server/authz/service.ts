import "server-only";
import type { PrismaClient } from "@/generated/prisma/client";
import { recordAudit } from "@/server/audit/audit";
import type { Db } from "@/server/db/client";
import { AppError } from "@/server/errors";
import { isPermission, type Permission } from "./permissions";
import { SUPER_ADMIN } from "./roles";

/** Utilisateur authentifié, avec ses rôles et permissions effectifs. */
export interface Actor {
  id: string;
  roles: readonly string[];
  permissions: ReadonlySet<Permission>;
}

/** Rôles et permissions effectifs d'un utilisateur (vides s'il est désactivé ou inconnu). */
export async function loadAccess(client: Db, userId: string): Promise<Omit<Actor, "id">> {
  const user = await client.user.findUnique({
    where: { id: userId },
    select: {
      isActive: true,
      roles: {
        select: { role: { select: { code: true, permissions: { select: { permission: { select: { code: true } } } } } } },
      },
    },
  });
  if (!user?.isActive) return { roles: [], permissions: new Set() };

  const permissions = new Set<Permission>();
  for (const { role } of user.roles) {
    for (const { permission } of role.permissions) {
      if (isPermission(permission.code)) permissions.add(permission.code);
    }
  }
  return { roles: user.roles.map(({ role }) => role.code), permissions };
}

async function deny(client: Db, actorId: string, entityType: string, entityId: string, message: string): Promise<never> {
  await recordAudit(client, { actorId, action: "authz.denied", entityType, entityId, result: "DENIED" });
  throw new AppError("FORBIDDEN", message);
}

/** Vérifie une permission côté serveur ; un refus est journalisé (DENIED) puis levé (FORBIDDEN). */
export async function assertPermission(client: Db, actor: Actor, permission: Permission): Promise<void> {
  if (actor.permissions.has(permission)) return;
  await deny(client, actor.id, "Permission", permission, "Vous n'avez pas l'autorisation d'effectuer cette action.");
}

async function assertCanManageRole(client: Db, actor: Actor, roleCode: string): Promise<string> {
  await assertPermission(client, actor, "roles.manage");
  if (roleCode === SUPER_ADMIN && !actor.roles.includes(SUPER_ADMIN)) {
    await deny(client, actor.id, "Role", SUPER_ADMIN, "Seul un administrateur principal peut gérer ce rôle.");
  }
  const role = await client.role.findUnique({ where: { code: roleCode }, select: { id: true } });
  if (!role) throw new AppError("NOT_FOUND", `Rôle inconnu : ${roleCode}`);
  return role.id;
}

/** Attribue un rôle (idempotent), avec audit. Le compte devient un compte du personnel (STAFF). */
export async function assignRole(client: PrismaClient, actor: Actor, userId: string, roleCode: string): Promise<void> {
  const roleId = await assertCanManageRole(client, actor, roleCode);
  await client.$transaction(async (tx) => {
    const user = await tx.user.findUnique({ where: { id: userId }, select: { id: true } });
    if (!user) throw new AppError("NOT_FOUND", "Utilisateur introuvable.");
    const already = await tx.userRole.findUnique({ where: { userId_roleId: { userId, roleId } } });
    if (already) return;
    await tx.userRole.create({ data: { userId, roleId } });
    await tx.user.update({ where: { id: userId }, data: { kind: "STAFF" } });
    await recordAudit(tx, {
      actorId: actor.id,
      action: "rbac.role.assign",
      entityType: "User",
      entityId: userId,
      after: { role: roleCode },
    });
  });
}

/**
 * Retire un rôle, avec audit. Refuse de retirer le dernier administrateur principal actif ;
 * le verrou consultatif sérialise les retraits concurrents d'un même rôle.
 */
export async function revokeRole(client: PrismaClient, actor: Actor, userId: string, roleCode: string): Promise<void> {
  const roleId = await assertCanManageRole(client, actor, roleCode);
  await client.$transaction(async (tx) => {
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${`role:${roleCode}`}))`;
    const assignment = await tx.userRole.findUnique({
      where: { userId_roleId: { userId, roleId } },
      select: { user: { select: { isActive: true } } },
    });
    if (!assignment) return;
    // Seul le retrait d'un administrateur principal ACTIF peut laisser la plateforme sans administrateur.
    if (roleCode === SUPER_ADMIN && assignment.user.isActive) {
      const activeSuperAdmins = await tx.userRole.count({ where: { roleId, user: { isActive: true } } });
      if (activeSuperAdmins <= 1) {
        throw new AppError("CONFLICT", "Impossible de retirer le dernier administrateur principal actif.");
      }
    }
    await tx.userRole.delete({ where: { userId_roleId: { userId, roleId } } });
    // Sans rôle, le compte redevient un compte client (redirections et accès cohérents).
    if ((await tx.userRole.count({ where: { userId } })) === 0) {
      await tx.user.update({ where: { id: userId }, data: { kind: "CUSTOMER" } });
    }
    await recordAudit(tx, {
      actorId: actor.id,
      action: "rbac.role.revoke",
      entityType: "User",
      entityId: userId,
      before: { role: roleCode },
    });
  });
}
