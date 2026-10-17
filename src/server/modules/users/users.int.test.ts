import { randomUUID } from "node:crypto";
import { beforeEach, describe, expect, it } from "vitest";
import { SUPER_ADMIN } from "@/server/authz/roles";
import { loadAccess, type Actor } from "@/server/authz/service";
import { syncRolesAndPermissions } from "@/server/authz/sync";
import { db } from "@/server/db/client";
import { resetDatabase } from "../../../../tests/setup/db";
import { actorWith } from "../../../../tests/support/actors";
import { getUserDetail, listUsers, setUserActive } from "./service";

async function customer(name: string, phone: string | null = null): Promise<string> {
  const id = randomUUID();
  await db.user.create({ data: { id, name, email: `${name.toLowerCase().replace(/\W/g, "")}-${id.slice(0, 6)}@client.sn`, phone } });
  return id;
}

const deactivate = (actor: Actor, userId: string) => setUserActive(db, actor, userId, { active: false, reason: "Départ de l'entreprise" });

describe("utilisateurs et rôles (PostgreSQL)", () => {
  let admin: Actor;

  beforeEach(async () => {
    await resetDatabase();
    await syncRolesAndPermissions(db);
    admin = await actorWith("ADMIN");
  });

  it("liste et recherche les comptes (nom, e-mail, téléphone), filtre par rôle et par état", async () => {
    await customer("Awa Diop", "77 111 22 33");
    await customer("Moussa Fall");
    const stock = await actorWith("STOCK_MANAGER");

    expect((await listUsers(db, admin, { q: "awa" })).rows.map((row) => row.name)).toEqual(["Awa Diop"]);
    expect((await listUsers(db, admin, { q: "111 22" })).total).toBe(1);
    expect((await listUsers(db, admin, { role: "STOCK_MANAGER" })).rows.map((row) => row.id)).toEqual([stock.id]);
    expect((await listUsers(db, admin, { kind: "CUSTOMER" })).total).toBe(2);
    await deactivate(admin, stock.id);
    expect((await listUsers(db, admin, { inactive: true })).rows.map((row) => row.id)).toEqual([stock.id]);
    // Un rôle inconnu dans l'URL n'est pas un filtre (pas d'erreur).
    expect((await listUsers(db, admin, { role: "INCONNU" })).total).toBe(4);
  });

  it("réserve la gestion des comptes à users.manage, refus journalisé", async () => {
    const finance = await actorWith("FINANCE_MANAGER");
    await expect(listUsers(db, finance)).rejects.toMatchObject({ code: "FORBIDDEN" });
    await expect(deactivate(finance, await customer("Cible"))).rejects.toMatchObject({ code: "FORBIDDEN" });
    expect(await db.auditLog.count({ where: { actorId: finance.id, result: "DENIED" } })).toBe(2);
  });

  it("désactive un compte : sessions supprimées, plus aucune permission, motif audité ; puis réactive", async () => {
    const stock = await actorWith("STOCK_MANAGER");
    await db.session.create({ data: { id: randomUUID(), token: randomUUID(), userId: stock.id, expiresAt: new Date(Date.now() + 3_600_000) } });

    await deactivate(admin, stock.id);
    expect(await db.session.count({ where: { userId: stock.id } })).toBe(0);
    expect((await loadAccess(db, stock.id)).permissions.size).toBe(0);
    const log = await db.auditLog.findFirstOrThrow({ where: { action: "user.deactivate", entityId: stock.id } });
    expect(log).toMatchObject({ actorId: admin.id, before: { isActive: true }, after: { isActive: false, reason: "Départ de l'entreprise" } });

    await deactivate(admin, stock.id); // idempotent : rien de plus
    expect(await db.auditLog.count({ where: { action: "user.deactivate" } })).toBe(1);

    await setUserActive(db, admin, stock.id, { active: true, reason: "Retour" });
    expect((await loadAccess(db, stock.id)).roles).toEqual(["STOCK_MANAGER"]);
  });

  it("exige un motif", async () => {
    await expect(setUserActive(db, admin, await customer("Cible"), { active: false, reason: "" })).rejects.toMatchObject({ code: "VALIDATION" });
  });

  it("refuse de se désactiver soi-même (refus journalisé)", async () => {
    await expect(deactivate(admin, admin.id)).rejects.toMatchObject({ code: "FORBIDDEN" });
    expect((await db.user.findUniqueOrThrow({ where: { id: admin.id } })).isActive).toBe(true);
    expect(await db.auditLog.count({ where: { action: "authz.denied", entityId: admin.id } })).toBe(1);
  });

  it("un administrateur ne touche pas au compte d'un administrateur principal", async () => {
    const superAdmin = await actorWith(SUPER_ADMIN);
    await actorWith(SUPER_ADMIN);
    await expect(deactivate(admin, superAdmin.id)).rejects.toMatchObject({ code: "FORBIDDEN" });
  });

  it("refuse de désactiver le dernier administrateur principal actif, même en parallèle", async () => {
    const first = await actorWith(SUPER_ADMIN);
    const second = await actorWith(SUPER_ADMIN);
    const results = await Promise.allSettled([deactivate(first, second.id), deactivate(second, first.id)]);
    expect(results.filter((result) => result.status === "fulfilled")).toHaveLength(1);
    const rejected = results.find((result) => result.status === "rejected");
    expect(rejected?.status === "rejected" && rejected.reason).toMatchObject({ code: "CONFLICT" });
    expect(await db.user.count({ where: { isActive: true, roles: { some: { role: { code: SUPER_ADMIN } } } } })).toBe(1);
  });

  it("propose à l'administrateur les rôles qu'il peut attribuer (sans administrateur principal)", async () => {
    const target = await customer("Cible");
    const detail = await getUserDetail(db, admin, target);
    expect(detail?.assignableRoles.map((role) => role.code)).not.toContain(SUPER_ADMIN);
    expect(detail?.assignableRoles).toHaveLength(9);
    const superAdmin = await actorWith(SUPER_ADMIN);
    expect((await getUserDetail(db, superAdmin, target))?.assignableRoles.map((role) => role.code)).toContain(SUPER_ADMIN);
    expect(await getUserDetail(db, admin, "inconnu")).toBeNull();
  });
});
