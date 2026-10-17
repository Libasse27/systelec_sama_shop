import "server-only";
import type { AuditResult, Prisma } from "@/generated/prisma/client";
import { assertPermission, type Actor } from "@/server/authz/service";
import type { Db } from "@/server/db/client";

export const AUDIT_PAGE_SIZE = 50;

const RESULTS: readonly AuditResult[] = ["SUCCESS", "FAILURE", "DENIED"];
export const parseAuditResult = (value: unknown): AuditResult | undefined => RESULTS.find((result) => result === value);

export interface AuditFilters {
  /** Acteur : identifiant exact, ou partie du nom ou de l'e-mail. « systeme » : actions sans acteur. */
  actor?: string;
  /** Action exacte, ou préfixe terminé par « . » (ex. « payment. »). */
  action?: string;
  entityType?: string;
  entityId?: string;
  result?: AuditResult;
  from?: Date;
  to?: Date;
  page?: number;
}

export interface AuditRow {
  id: string;
  createdAt: Date;
  actorId: string | null;
  actorName: string | null;
  actorEmail: string | null;
  action: string;
  entityType: string | null;
  entityId: string | null;
  result: AuditResult;
  ip: string | null;
  before: Prisma.JsonValue;
  after: Prisma.JsonValue;
}

const clip = (value: string | undefined, max = 120): string | undefined => {
  const text = value?.trim().slice(0, max);
  return text ? text : undefined;
};

async function actorCondition(client: Db, actor: string | undefined): Promise<Prisma.AuditLogWhereInput> {
  if (!actor) return {};
  if (actor === "systeme") return { actorId: null };
  const users = await client.user.findMany({
    where: { OR: [{ id: actor }, { email: { contains: actor, mode: "insensitive" } }, { name: { contains: actor, mode: "insensitive" } }] },
    select: { id: true },
    take: 50,
  });
  return { actorId: { in: users.map((user) => user.id) } };
}

/**
 * Journal d'audit en lecture seule (audit.read), filtrable et paginé, le plus récent d'abord.
 * Les valeurs avant/après sont déjà masquées à l'écriture (aucun secret journalisé).
 */
export async function listAuditLogs(
  client: Db,
  viewer: Actor,
  filters: AuditFilters = {},
): Promise<{ rows: AuditRow[]; total: number; page: number; pageCount: number }> {
  await assertPermission(client, viewer, "audit.read");
  const action = clip(filters.action, 80);
  const where: Prisma.AuditLogWhereInput = {
    ...(await actorCondition(client, clip(filters.actor))),
    ...(action ? (action.endsWith(".") ? { action: { startsWith: action } } : { action }) : {}),
    ...(clip(filters.entityType, 60) ? { entityType: clip(filters.entityType, 60) } : {}),
    ...(clip(filters.entityId) ? { entityId: clip(filters.entityId) } : {}),
    ...(filters.result ? { result: filters.result } : {}),
    ...(filters.from || filters.to ? { createdAt: { ...(filters.from && { gte: filters.from }), ...(filters.to && { lt: filters.to }) } } : {}),
  };
  const total = await client.auditLog.count({ where });
  const pageCount = Math.max(1, Math.ceil(total / AUDIT_PAGE_SIZE));
  const page = Math.min(Math.max(1, Math.trunc(filters.page ?? 1)), pageCount);
  const logs = await client.auditLog.findMany({
    where,
    orderBy: [{ createdAt: "desc" }, { id: "desc" }],
    skip: (page - 1) * AUDIT_PAGE_SIZE,
    take: AUDIT_PAGE_SIZE,
    select: { id: true, createdAt: true, actorId: true, action: true, entityType: true, entityId: true, result: true, ip: true, before: true, after: true },
  });
  const actorIds = [...new Set(logs.map((log) => log.actorId).filter((id): id is string => id !== null))];
  const users = await client.user.findMany({ where: { id: { in: actorIds } }, select: { id: true, name: true, email: true } });
  const byId = new Map(users.map((user) => [user.id, user]));
  const rows = logs.map((log) => {
    const user = log.actorId ? byId.get(log.actorId) : undefined;
    return { ...log, actorName: user?.name ?? null, actorEmail: user?.email ?? null };
  });
  return { rows, total, page, pageCount };
}

/** Types d'entités présents dans le journal (liste de filtre). */
export async function listAuditEntityTypes(client: Db, viewer: Actor): Promise<string[]> {
  await assertPermission(client, viewer, "audit.read");
  const groups = await client.auditLog.groupBy({ by: ["entityType"], where: { entityType: { not: null } }, orderBy: { entityType: "asc" } });
  return groups.map((group) => group.entityType).filter((type): type is string => type !== null);
}
