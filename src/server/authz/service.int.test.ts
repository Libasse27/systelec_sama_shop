import { randomUUID } from "node:crypto";
import { beforeEach, describe, expect, it } from "vitest";
import { db } from "@/server/db/client";
import { resetDatabase } from "../../../tests/setup/db";
import { ROLE_DEFINITIONS, SUPER_ADMIN } from "./roles";
import { assertPermission, assignRole, loadAccess, revokeRole, type Actor } from "./service";
import { syncRolesAndPermissions } from "./sync";

async function createUser(roleCodes: string[] = [], isActive = true): Promise<string> {
  const id = randomUUID();
  await db.user.create({
    data: {
      id,
      name: "Test",
      email: `${id}@test.sn`,
      isActive,
      kind: roleCodes.length > 0 ? "STAFF" : "CUSTOMER",
      roles: { create: roleCodes.map((code) => ({ role: { connect: { code } } })) },
    },
  });
  return id;
}

async function actorFor(userId: string): Promise<Actor> {
  return { id: userId, ...(await loadAccess(db, userId)) };
}

describe("RBAC (PostgreSQL)", () => {
  beforeEach(async () => {
    await resetDatabase();
    await syncRolesAndPermissions(db);
  });

  it("synchronise les rôles de façon idempotente et journalise la création", async () => {
    expect(await db.role.count()).toBe(10);
    expect(await db.auditLog.count({ where: { action: "rbac.role.create" } })).toBe(10);
    expect(await syncRolesAndPermissions(db)).toEqual({ permissionsCreated: 0, rolesCreated: 0, rolesUpdated: [] });
  });

  it.each(ROLE_DEFINITIONS.map((role) => [role.code, role.permissions] as const))(
    "applique les permissions du rôle %s (§20 n° 3)",
    async (code, permissions) => {
      const access = await loadAccess(db, await createUser([code]));
      expect([...access.permissions].sort()).toEqual([...permissions].sort());
    },
  );

  it("n'accorde aucune permission à un client ni à un compte désactivé", async () => {
    expect((await loadAccess(db, await createUser())).permissions.size).toBe(0);
    expect((await loadAccess(db, await createUser([SUPER_ADMIN], false))).permissions.size).toBe(0);
  });

  it("refuse une action non autorisée et journalise le refus (§20 n° 16 et 24)", async () => {
    const technician = await actorFor(await createUser(["TECHNICIAN"]));
    await expect(assertPermission(db, technician, "payments.record")).rejects.toMatchObject({ code: "FORBIDDEN" });
    const log = await db.auditLog.findFirstOrThrow({ where: { action: "authz.denied" } });
    expect(log).toMatchObject({ actorId: technician.id, entityId: "payments.record", result: "DENIED" });

    const finance = await actorFor(await createUser(["FINANCE_MANAGER"]));
    await expect(assertPermission(db, finance, "payments.record")).resolves.toBeUndefined();
  });

  it("attribue et retire un rôle avec audit", async () => {
    const admin = await actorFor(await createUser(["ADMIN"]));
    const target = await createUser();

    await assignRole(db, admin, target, "STOCK_MANAGER");
    expect((await db.user.findUniqueOrThrow({ where: { id: target } })).kind).toBe("STAFF");
    expect((await loadAccess(db, target)).roles).toEqual(["STOCK_MANAGER"]);

    await revokeRole(db, admin, target, "STOCK_MANAGER");
    expect((await loadAccess(db, target)).roles).toEqual([]);
    const actions = (await db.auditLog.findMany({ where: { entityId: target }, orderBy: { createdAt: "asc" } })).map(
      (log) => log.action,
    );
    expect(actions).toEqual(["rbac.role.assign", "rbac.role.revoke"]);
  });

  it("réserve la gestion du rôle d'administrateur principal à un administrateur principal", async () => {
    const admin = await actorFor(await createUser(["ADMIN"]));
    await expect(assignRole(db, admin, await createUser(), SUPER_ADMIN)).rejects.toMatchObject({ code: "FORBIDDEN" });

    const superAdmin = await actorFor(await createUser([SUPER_ADMIN]));
    const promoted = await createUser();
    await assignRole(db, superAdmin, promoted, SUPER_ADMIN);
    expect((await loadAccess(db, promoted)).roles).toContain(SUPER_ADMIN);
  });

  it("repasse le compte en client quand il perd son dernier rôle", async () => {
    const admin = await actorFor(await createUser(["ADMIN"]));
    const target = await createUser(["STOCK_MANAGER", "CATALOG_MANAGER"]);
    await revokeRole(db, admin, target, "STOCK_MANAGER");
    expect((await db.user.findUniqueOrThrow({ where: { id: target } })).kind).toBe("STAFF");
    await revokeRole(db, admin, target, "CATALOG_MANAGER");
    expect((await db.user.findUniqueOrThrow({ where: { id: target } })).kind).toBe("CUSTOMER");
  });

  it("signale un rôle ou un utilisateur inconnu", async () => {
    const admin = await actorFor(await createUser(["ADMIN"]));
    await expect(assignRole(db, admin, await createUser(), "INCONNU")).rejects.toMatchObject({ code: "NOT_FOUND" });
    await expect(assignRole(db, admin, "utilisateur-inexistant", "STOCK_MANAGER")).rejects.toMatchObject({
      code: "NOT_FOUND",
    });
  });

  it("interdit à un administrateur de retirer le rôle d'administrateur principal", async () => {
    await createUser([SUPER_ADMIN]);
    const target = await createUser([SUPER_ADMIN]);
    const admin = await actorFor(await createUser(["ADMIN"]));
    await expect(revokeRole(db, admin, target, SUPER_ADMIN)).rejects.toMatchObject({ code: "FORBIDDEN" });
  });

  it("permet de retirer le rôle d'un administrateur principal désactivé", async () => {
    const active = await createUser([SUPER_ADMIN]);
    const inactive = await createUser([SUPER_ADMIN], false);
    await revokeRole(db, await actorFor(active), inactive, SUPER_ADMIN);
    expect((await db.userRole.count({ where: { userId: inactive } }))).toBe(0);
  });

  it("refuse de retirer le dernier administrateur principal actif", async () => {
    const onlySuperAdmin = await createUser([SUPER_ADMIN]);
    const actor = await actorFor(onlySuperAdmin);
    await expect(revokeRole(db, actor, onlySuperAdmin, SUPER_ADMIN)).rejects.toMatchObject({ code: "CONFLICT" });
    expect((await loadAccess(db, onlySuperAdmin)).roles).toContain(SUPER_ADMIN);

    // Un second administrateur principal désactivé ne compte pas.
    await createUser([SUPER_ADMIN], false);
    await expect(revokeRole(db, actor, onlySuperAdmin, SUPER_ADMIN)).rejects.toMatchObject({ code: "CONFLICT" });

    const second = await createUser([SUPER_ADMIN]);
    await revokeRole(db, actor, second, SUPER_ADMIN);
    expect((await loadAccess(db, second)).roles).toEqual([]);
  });
});
