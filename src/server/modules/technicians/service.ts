import "server-only";
import { z } from "zod";
import { optionalText } from "@/lib/schema-text";
import type { PrismaClient } from "@/generated/prisma/client";
import { recordAudit } from "@/server/audit/audit";
import { assertPermission, type Actor } from "@/server/authz/service";
import type { Db } from "@/server/db/client";
import { AppError } from "@/server/errors";
import { parseInput } from "@/server/validation";

export const TECHNICIAN_ROLE = "TECHNICIAN";

const profileSchema = z.object({ skills: optionalText(500), zones: optionalText(500), isActive: z.boolean() });

export interface TechnicianRow {
  userId: string;
  name: string;
  email: string;
  /** Profil technicien (null tant qu'il n'a pas été créé). */
  technicianId: string | null;
  skills: string | null;
  zones: string | null;
  isActive: boolean;
  openInterventions: number;
}

/** Comptes actifs portant le rôle technicien, avec leur profil (interventions.read ou .manage). */
export async function listTechnicians(client: Db, actor: Actor): Promise<TechnicianRow[]> {
  if (!actor.permissions.has("interventions.manage")) await assertPermission(client, actor, "interventions.read");
  const users = await client.user.findMany({
    where: { isActive: true, roles: { some: { role: { code: TECHNICIAN_ROLE } } } },
    orderBy: { name: "asc" },
    take: 200,
    select: {
      id: true,
      name: true,
      email: true,
      technician: {
        select: {
          id: true,
          skills: true,
          zones: true,
          isActive: true,
          _count: { select: { interventions: { where: { status: { in: ["SCHEDULED", "IN_PROGRESS"] } } } } },
        },
      },
    },
  });
  return users.map((user) => ({
    userId: user.id,
    name: user.name,
    email: user.email,
    technicianId: user.technician?.id ?? null,
    skills: user.technician?.skills ?? null,
    zones: user.technician?.zones ?? null,
    isActive: user.technician?.isActive ?? false,
    openInterventions: user.technician?._count.interventions ?? 0,
  }));
}

/** Techniciens planifiables : profil actif et compte actif. */
export async function listSchedulableTechnicians(client: Db): Promise<{ id: string; name: string; zones: string | null }[]> {
  const rows = await client.technician.findMany({
    where: { isActive: true, user: { isActive: true, roles: { some: { role: { code: TECHNICIAN_ROLE } } } } },
    orderBy: { user: { name: "asc" } },
    select: { id: true, zones: true, user: { select: { name: true } } },
  });
  return rows.map((row) => ({ id: row.id, name: row.user.name, zones: row.zones }));
}

/** Crée ou modifie le profil technicien d'un compte portant le rôle TECHNICIAN (interventions.manage). */
export async function saveTechnicianProfile(client: PrismaClient, actor: Actor, userId: string, input: unknown): Promise<void> {
  await assertPermission(client, actor, "interventions.manage");
  const profile = parseInput(profileSchema, input, "Technicien");
  const user = await client.user.findFirst({ where: { id: userId, roles: { some: { role: { code: TECHNICIAN_ROLE } } } }, select: { id: true } });
  if (!user) throw new AppError("NOT_FOUND", "Ce compte n'a pas le rôle technicien.");
  await client.$transaction(async (tx) => {
    const saved = await tx.technician.upsert({ where: { userId }, create: { userId, ...profile }, update: profile, select: { id: true } });
    await recordAudit(tx, { actorId: actor.id, action: "technician.save", entityType: "Technician", entityId: saved.id, after: { userId, ...profile } });
  });
}
