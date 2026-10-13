import { beforeEach, describe, expect, it } from "vitest";
import { db } from "@/server/db/client";
import { ValidationError } from "@/server/errors";
import { resetDatabase } from "../../../../tests/setup/db";
import { settingsDefaults } from "./schemas";
import { getSetting, updateSetting } from "./service";

describe("paramètres : service (PostgreSQL)", () => {
  beforeEach(resetDatabase);

  it("renvoie les valeurs par défaut quand rien n'est enregistré", async () => {
    expect(await getSetting("company")).toEqual(settingsDefaults.company);
  });

  it("enregistre une valeur valide et l'audite avec avant/après", async () => {
    const next = { ...settingsDefaults.company, phone: "+221 00 000 00 00" };
    await updateSetting("company", next, "user_test");

    expect(await getSetting("company")).toEqual(next);
    const logs = await db.auditLog.findMany({ where: { action: "settings.update", entityId: "company" } });
    expect(logs).toHaveLength(1);
    expect(logs[0]?.actorId).toBe("user_test");
    expect(logs[0]?.before).toMatchObject({ phone: null });
    expect(logs[0]?.after).toMatchObject({ phone: "+221 00 000 00 00" });
  });

  it("signale une valeur stockée invalide et permet à l'admin de l'écraser", async () => {
    await db.siteSetting.create({ data: { key: "payments", value: { enabledMethods: ["WAVE"] } } });
    await expect(getSetting("payments")).rejects.toMatchObject({ code: "INTERNAL" });

    const fixed = { enabledMethods: ["CASH_ON_PICKUP"] };
    await expect(updateSetting("payments", fixed, "user_test")).resolves.toEqual(fixed);
    expect(await getSetting("payments")).toEqual(fixed);
    const log = await db.auditLog.findFirstOrThrow({ where: { action: "settings.update" } });
    expect(log.before).toEqual({ enabledMethods: ["WAVE"] }); // valeur brute conservée pour l'enquête
  });

  it("refuse une valeur invalide sans rien écrire", async () => {
    await expect(updateSetting("payments", { enabledMethods: ["WAVE"] }, "user_test")).rejects.toBeInstanceOf(
      ValidationError,
    );
    expect(await db.siteSetting.count()).toBe(0);
    expect(await db.auditLog.count()).toBe(0);
  });
});
