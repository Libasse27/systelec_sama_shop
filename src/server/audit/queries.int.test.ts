import { beforeEach, describe, expect, it } from "vitest";
import type { Actor } from "@/server/authz/service";
import { syncRolesAndPermissions } from "@/server/authz/sync";
import { db } from "@/server/db/client";
import { resetDatabase } from "../../../tests/setup/db";
import { actorWith } from "../../../tests/support/actors";
import { recordAudit } from "./audit";
import { AUDIT_PAGE_SIZE, listAuditEntityTypes, listAuditLogs } from "./queries";

describe("consultation du journal d'audit (PostgreSQL)", () => {
  let auditor: Actor;
  let other: Actor;

  beforeEach(async () => {
    await resetDatabase();
    await syncRolesAndPermissions(db); // journalise rbac.role.create (sans acteur)
    auditor = await actorWith("ADMIN");
    other = await actorWith("FINANCE_MANAGER");
    await recordAudit(db, { actorId: other.id, action: "payment.record", entityType: "Payment", entityId: "p1", after: { amount: 1000 } });
    await recordAudit(db, { actorId: other.id, action: "payment.void", entityType: "Payment", entityId: "p1" });
    await recordAudit(db, { actorId: auditor.id, action: "settings.update", entityType: "SiteSetting", entityId: "company", result: "SUCCESS" });
    await recordAudit(db, { actorId: other.id, action: "authz.denied", entityType: "Permission", entityId: "users.manage", result: "DENIED" });
  });

  it("filtre par acteur (nom, e-mail, système), action (exacte ou préfixe), entité, résultat et période", async () => {
    expect((await listAuditLogs(db, auditor, { actor: "FINANCE" })).total).toBe(3);
    expect((await listAuditLogs(db, auditor, { actor: other.id.slice(0, 8) })).total).toBe(3); // e-mail = <id>@test.sn
    // Une création par rôle système (11 depuis le rôle Livreur, phase 10).
    expect((await listAuditLogs(db, auditor, { actor: "systeme" })).total).toBe(11);
    expect((await listAuditLogs(db, auditor, { action: "payment." })).rows.map((row) => row.action)).toEqual(["payment.void", "payment.record"]);
    expect((await listAuditLogs(db, auditor, { action: "payment" })).total).toBe(0);
    expect((await listAuditLogs(db, auditor, { entityType: "Payment", entityId: "p1" })).total).toBe(2);
    expect((await listAuditLogs(db, auditor, { result: "DENIED" })).rows[0]).toMatchObject({ entityId: "users.manage", actorName: "FINANCE_MANAGER" });
    expect((await listAuditLogs(db, auditor, { from: new Date(Date.now() + 60_000) })).total).toBe(0);
    expect((await listAuditLogs(db, auditor, { actor: "personne-inconnue" })).total).toBe(0);
    expect(await listAuditEntityTypes(db, auditor)).toEqual(["Payment", "Permission", "Role", "SiteSetting"]);
  });

  it("pagine du plus récent au plus ancien", async () => {
    for (let index = 0; index < AUDIT_PAGE_SIZE; index += 1) await recordAudit(db, { actorId: null, action: "test.bulk" });
    const first = await listAuditLogs(db, auditor, { action: "test.bulk" });
    expect(first).toMatchObject({ total: AUDIT_PAGE_SIZE, pageCount: 1 });
    const all = await listAuditLogs(db, auditor, { page: 2 });
    expect(all.page).toBe(2);
    expect(all.rows.length).toBe(AUDIT_PAGE_SIZE + 15 - AUDIT_PAGE_SIZE);
    const outOfRange = await listAuditLogs(db, auditor, { page: 99 });
    expect(outOfRange.page).toBe(outOfRange.pageCount);
  });

  it("réservé à audit.read, refus journalisé ; lecture seule (le journal reste en ajout seul)", async () => {
    await expect(listAuditLogs(db, other)).rejects.toMatchObject({ code: "FORBIDDEN" });
    expect(await db.auditLog.count({ where: { action: "authz.denied", entityId: "audit.read", actorId: other.id } })).toBe(1);
    await expect(db.auditLog.deleteMany({})).rejects.toThrow(/append-only|ajout seul|interdit/i);
  });
});
