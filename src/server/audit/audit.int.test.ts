import { beforeEach, describe, expect, it } from "vitest";
import { db } from "@/server/db/client";
import { resetDatabase } from "../../../tests/setup/db";
import { recordAudit } from "./audit";

describe("journal d'audit (PostgreSQL)", () => {
  beforeEach(resetDatabase);

  it("enregistre un événement en masquant les secrets", async () => {
    await recordAudit(db, { actorId: "u1", action: "auth.login", after: { email: "a@b.sn", password: "secret" } });
    const log = await db.auditLog.findFirstOrThrow();
    expect(log.after).toEqual({ email: "a@b.sn", password: "[MASQUÉ]" });
    expect(log.result).toBe("SUCCESS");
  });

  it("est append-only : UPDATE et DELETE sont refusés par la base", async () => {
    await recordAudit(db, { actorId: "u1", action: "test.event" });
    const log = await db.auditLog.findFirstOrThrow();

    await expect(db.auditLog.update({ where: { id: log.id }, data: { action: "falsifié" } })).rejects.toThrow();
    await expect(db.auditLog.delete({ where: { id: log.id } })).rejects.toThrow();
    await expect(db.auditLog.findUniqueOrThrow({ where: { id: log.id } })).resolves.toMatchObject({ action: "test.event" });
  });
});
