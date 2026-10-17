import "server-only";
import { z } from "zod";
import type { Prisma, PrismaClient, UserKind } from "@/generated/prisma/client";
import { recordAudit } from "@/server/audit/audit";
import { findRoleDefinition, ROLE_CODES, SUPER_ADMIN } from "@/server/authz/roles";
import { assertPermission, type Actor } from "@/server/authz/service";
import type { Db } from "@/server/db/client";
import { AppError } from "@/server/errors";
import { parseInput } from "@/server/validation";

export const USERS_PAGE_SIZE = 30;

export interface UserRow {
  id: string;
  name: string;
  email: string;
  phone: string | null;
  kind: UserKind;
  isActive: boolean;
  roles: { code: string; label: string }[];
  createdAt: Date;
}

export interface UserListOptions {
  q?: string;
  kind?: UserKind;
  role?: string;
  /** Vrai : comptes désactivés seulement ; faux : actifs seulement. */
  inactive?: boolean;
  page?: number;
}

const USER_SELECT = {
  id: true,
  name: true,
  email: true,
  phone: true,
  kind: true,
  isActive: true,
  createdAt: true,
  roles: { orderBy: { role: { code: "asc" } }, select: { role: { select: { code: true, label: true } } } },
} satisfies Prisma.UserSelect;

const toRow = ({ roles, ...user }: Prisma.UserGetPayload<{ select: typeof USER_SELECT }>): UserRow => ({
  ...user,
  roles: roles.map(({ role }) => role),
});

export const isRoleCode = (value: unknown): value is string => typeof value === "string" && ROLE_CODES.includes(value);

/** Comptes (personnel et clients), recherche par nom, e-mail ou téléphone (users.manage). */
export async function listUsers(
  client: Db,
  actor: Actor,
  options: UserListOptions = {},
): Promise<{ rows: UserRow[]; total: number; page: number; pageCount: number }> {
  await assertPermission(client, actor, "users.manage");
  const q = options.q?.trim().slice(0, 100);
  const where: Prisma.UserWhereInput = {
    ...(options.kind ? { kind: options.kind } : {}),
    ...(options.role && isRoleCode(options.role) ? { roles: { some: { role: { code: options.role } } } } : {}),
    ...(options.inactive !== undefined ? { isActive: !options.inactive } : {}),
    ...(q
      ? {
          OR: [
            { name: { contains: q, mode: "insensitive" } },
            { email: { contains: q, mode: "insensitive" } },
            { phone: { contains: q } },
          ],
        }
      : {}),
  };
  const total = await client.user.count({ where });
  const pageCount = Math.max(1, Math.ceil(total / USERS_PAGE_SIZE));
  const page = Math.min(Math.max(1, Math.trunc(options.page ?? 1)), pageCount);
  const users = await client.user.findMany({
    where,
    orderBy: [{ createdAt: "desc" }, { id: "desc" }],
    skip: (page - 1) * USERS_PAGE_SIZE,
    take: USERS_PAGE_SIZE,
    select: USER_SELECT,
  });
  return { rows: users.map(toRow), total, page, pageCount };
}

export interface UserDetail extends UserRow {
  lastSessionAt: Date | null;
  /** Rôles que l'acteur peut attribuer (le rôle d'administrateur principal : par un administrateur principal seulement). */
  assignableRoles: { code: string; label: string }[];
}

export async function getUserDetail(client: Db, actor: Actor, userId: string): Promise<UserDetail | null> {
  await assertPermission(client, actor, "users.manage");
  const user = await client.user.findUnique({
    where: { id: userId },
    select: { ...USER_SELECT, sessions: { orderBy: { updatedAt: "desc" }, take: 1, select: { updatedAt: true } } },
  });
  if (!user) return null;
  const { sessions, ...rest } = user;
  const row = toRow(rest);
  const held = new Set(row.roles.map((role) => role.code));
  const assignableRoles = ROLE_CODES.filter((code) => !held.has(code) && (code !== SUPER_ADMIN || actor.roles.includes(SUPER_ADMIN))).map((code) => ({
    code,
    label: findRoleDefinition(code)?.label ?? code,
  }));
  return { ...row, lastSessionAt: sessions[0]?.updatedAt ?? null, assignableRoles };
}

const activationSchema = z.object({ active: z.boolean(), reason: z.string().trim().min(3, "Indiquez le motif").max(300) });

/**
 * Active ou désactive un compte (users.manage), avec motif et audit. Un compte désactivé n'a plus
 * aucune session ni permission. Refusé : se désactiver soi-même, désactiver un administrateur
 * principal sans l'être, désactiver le dernier administrateur principal actif (verrou partagé
 * avec le retrait de rôle : pas de course entre les deux).
 */
export async function setUserActive(client: PrismaClient, actor: Actor, userId: string, input: unknown): Promise<void> {
  await assertPermission(client, actor, "users.manage");
  const { active, reason } = parseInput(activationSchema, input, "Activation du compte");
  if (userId === actor.id && !active) {
    await recordAudit(client, { actorId: actor.id, action: "authz.denied", entityType: "User", entityId: userId, result: "DENIED" });
    throw new AppError("FORBIDDEN", "Vous ne pouvez pas désactiver votre propre compte.");
  }
  const target = await client.user.findUnique({ where: { id: userId }, select: { roles: { select: { role: { select: { code: true } } } } } });
  if (!target) throw new AppError("NOT_FOUND", "Utilisateur introuvable.");
  const targetIsSuperAdmin = target.roles.some(({ role }) => role.code === SUPER_ADMIN);
  if (targetIsSuperAdmin && !actor.roles.includes(SUPER_ADMIN)) {
    await recordAudit(client, { actorId: actor.id, action: "authz.denied", entityType: "User", entityId: userId, result: "DENIED" });
    throw new AppError("FORBIDDEN", "Seul un administrateur principal peut modifier le compte d'un administrateur principal.");
  }

  await client.$transaction(async (tx) => {
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${`role:${SUPER_ADMIN}`}))`;
    const current = await tx.user.findUniqueOrThrow({ where: { id: userId }, select: { isActive: true, roles: { select: { role: { select: { code: true } } } } } });
    // Rôles relus sous le verrou : une promotion concurrente en administrateur principal est vue ici.
    const superAdminNow = current.roles.some(({ role }) => role.code === SUPER_ADMIN);
    if (superAdminNow && !actor.roles.includes(SUPER_ADMIN)) {
      throw new AppError("FORBIDDEN", "Seul un administrateur principal peut modifier le compte d'un administrateur principal.");
    }
    if (current.isActive === active) return;
    if (!active && superAdminNow) {
      const activeSuperAdmins = await tx.userRole.count({ where: { role: { code: SUPER_ADMIN }, user: { isActive: true } } });
      if (activeSuperAdmins <= 1) throw new AppError("CONFLICT", "Impossible de désactiver le dernier administrateur principal actif.");
    }
    await tx.user.update({ where: { id: userId }, data: { isActive: active } });
    // Plus aucune session ouverte : la désactivation prend effet immédiatement.
    if (!active) await tx.session.deleteMany({ where: { userId } });
    await recordAudit(tx, {
      actorId: actor.id,
      action: active ? "user.activate" : "user.deactivate",
      entityType: "User",
      entityId: userId,
      before: { isActive: current.isActive },
      after: { isActive: active, reason },
    });
  });
}
