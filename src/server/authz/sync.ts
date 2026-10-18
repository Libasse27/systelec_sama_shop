import "server-only";
import type { PrismaClient } from "@/generated/prisma/client";
import { recordAudit } from "@/server/audit/audit";
import { PERMISSIONS } from "./permissions";
import { ROLE_DEFINITIONS } from "./roles";

export interface SyncResult {
  permissionsCreated: number;
  rolesCreated: number;
  rolesUpdated: string[];
}

/**
 * Aligne la base sur les définitions du code (permissions, rôles système, matrice).
 * Idempotent : un second appel ne change rien. Toute modification est auditée.
 */
export async function syncRolesAndPermissions(client: PrismaClient): Promise<SyncResult> {
  return client.$transaction(async (tx) => {
    const existingPermissions = await tx.permission.findMany({ select: { code: true } });
    const known = new Set(existingPermissions.map((p) => p.code));
    const missing = PERMISSIONS.filter((code) => !known.has(code));
    if (missing.length > 0) {
      await tx.permission.createMany({ data: missing.map((code) => ({ code })) });
    }
    const permissionIds = new Map(
      (await tx.permission.findMany({ select: { id: true, code: true } })).map((p) => [p.code, p.id]),
    );

    let rolesCreated = 0;
    const rolesUpdated: string[] = [];
    for (const definition of ROLE_DEFINITIONS) {
      const existing = await tx.role.findUnique({
        where: { code: definition.code },
        select: { label: true, permissions: { select: { permission: { select: { code: true } } } } },
      });
      const wanted = [...definition.permissions].sort();
      const current = (existing?.permissions.map((rp) => rp.permission.code) ?? []).sort();
      if (existing && existing.label === definition.label && wanted.join() === current.join()) continue;

      const role = await tx.role.upsert({
        where: { code: definition.code },
        create: { code: definition.code, label: definition.label, isSystem: true },
        update: { label: definition.label },
      });
      await tx.rolePermission.deleteMany({ where: { roleId: role.id } });
      await tx.rolePermission.createMany({
        data: wanted.map((code) => ({ roleId: role.id, permissionId: permissionIds.get(code)! })),
      });
      await recordAudit(tx, {
        actorId: null,
        action: existing ? "rbac.role.update" : "rbac.role.create",
        entityType: "Role",
        entityId: definition.code,
        before: existing ? { label: existing.label, permissions: current } : undefined,
        after: { label: definition.label, permissions: wanted },
      });
      if (existing) rolesUpdated.push(definition.code);
      else rolesCreated += 1;
    }

    return { permissionsCreated: missing.length, rolesCreated, rolesUpdated };
  });
}
