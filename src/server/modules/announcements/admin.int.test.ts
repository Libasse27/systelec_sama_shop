import { beforeEach, describe, expect, it } from "vitest";
import type { Actor } from "@/server/authz/service";
import { syncRolesAndPermissions } from "@/server/authz/sync";
import { db } from "@/server/db/client";
import { getAllSettings, saveSettings } from "@/server/modules/settings/admin";
import { getSetting } from "@/server/modules/settings/service";
import { resetDatabase } from "../../../../tests/setup/db";
import { actorWith } from "../../../../tests/support/actors";
import { addAnnouncement, deleteAnnouncement, getAnnouncements, saveRotation, updateAnnouncement } from "./admin";

const DRAFT = { text: "Soldes sur les routeurs", href: "/produits", kind: "PROMOTION", isActive: true, startsAt: null, endsAt: null } as const;

describe("administration des annonces (PostgreSQL)", () => {
  let owner: Actor;
  let admin: Actor;

  beforeEach(async () => {
    await resetDatabase();
    await syncRolesAndPermissions(db);
    owner = await actorWith("SUPER_ADMIN");
    admin = await actorWith("ADMIN");
  });

  it("l'administrateur principal ajoute, modifie et supprime une annonce, avec audit", async () => {
    const added = await addAnnouncement(db, owner, DRAFT);
    expect(added.id).toMatch(/^[0-9a-f-]{36}$/);
    expect((await getAnnouncements(db, owner)).items).toEqual([added]);

    const updated = await updateAnnouncement(db, owner, added.id, { ...DRAFT, text: "Nouveau texte", isActive: false });
    expect(updated).toMatchObject({ id: added.id, text: "Nouveau texte", isActive: false });
    expect((await getSetting("announcements", db)).items).toEqual([updated]);

    await saveRotation(db, owner, 10);
    expect((await getAnnouncements(db, owner)).rotationSeconds).toBe(10);

    await deleteAnnouncement(db, owner, added.id);
    expect((await getSetting("announcements", db)).items).toEqual([]);

    const audits = await db.auditLog.findMany({ where: { action: "settings.update", entityId: "announcements", actorId: owner.id }, orderBy: { createdAt: "asc" } });
    expect(audits).toHaveLength(4);
    expect(audits[0]!.before).toEqual({ items: [], rotationSeconds: 6 });
    expect(audits[0]!.after).toMatchObject({ items: [{ id: added.id }] });
  });

  it("erreurs rattachées au champ, rien d'écrit", async () => {
    await expect(addAnnouncement(db, owner, { ...DRAFT, href: "//evil.com" })).rejects.toMatchObject({ code: "VALIDATION", details: { fieldErrors: { href: expect.any(Array) } } });
    await expect(addAnnouncement(db, owner, { ...DRAFT, text: "" })).rejects.toMatchObject({ code: "VALIDATION" });
    await expect(addAnnouncement(db, owner, { ...DRAFT, startsAt: "2026-11-02T00:00:00.000Z", endsAt: "2026-11-01T00:00:00.000Z" })).rejects.toMatchObject({ code: "VALIDATION" });
    await expect(saveRotation(db, owner, 2)).rejects.toMatchObject({ code: "VALIDATION" });
    expect(await db.siteSetting.count({ where: { key: "announcements" } })).toBe(0);
  });

  it("modifier ou supprimer une annonce inconnue : NOT_FOUND", async () => {
    const unknown = "5b1f3a52-9c1e-4d52-8d55-0d1c3a6f7a10";
    await expect(updateAnnouncement(db, owner, unknown, DRAFT)).rejects.toMatchObject({ code: "NOT_FOUND" });
    await expect(deleteAnnouncement(db, owner, unknown)).rejects.toMatchObject({ code: "NOT_FOUND" });
  });

  it("refuse la 11e annonce", async () => {
    for (let index = 0; index < 10; index += 1) await addAnnouncement(db, owner, { ...DRAFT, text: `Annonce ${index}` });
    await expect(addAnnouncement(db, owner, DRAFT)).rejects.toMatchObject({ code: "VALIDATION" });
    expect((await getAnnouncements(db, owner)).items).toHaveLength(10);
  });

  it("l'administrateur est refusé et le refus est journalisé", async () => {
    await expect(addAnnouncement(db, admin, DRAFT)).rejects.toMatchObject({ code: "FORBIDDEN" });
    await expect(getAnnouncements(db, admin)).rejects.toMatchObject({ code: "FORBIDDEN" });
    await expect(updateAnnouncement(db, admin, "x", DRAFT)).rejects.toMatchObject({ code: "FORBIDDEN" });
    await expect(deleteAnnouncement(db, admin, "x")).rejects.toMatchObject({ code: "FORBIDDEN" });
    await expect(saveRotation(db, admin, 8)).rejects.toMatchObject({ code: "FORBIDDEN" });
    expect(await db.auditLog.count({ where: { action: "authz.denied", entityId: "announcements.manage", actorId: admin.id } })).toBe(5);
    expect(await db.siteSetting.count({ where: { key: "announcements" } })).toBe(0);
  });

  it("le circuit générique des paramètres ne peut pas écrire les annonces, même pour l'administrateur principal", async () => {
    const payload = { items: [], rotationSeconds: 6 };
    await expect(saveSettings(db, admin, "announcements" as never, payload)).rejects.toMatchObject({ code: "FORBIDDEN" });
    await expect(saveSettings(db, owner, "announcements" as never, payload)).rejects.toMatchObject({ code: "FORBIDDEN" });
    expect(await db.siteSetting.count({ where: { key: "announcements" } })).toBe(0);
  });

  it("getAllSettings n'expose pas les annonces", async () => {
    expect(Object.keys(await getAllSettings(db, admin))).not.toContain("announcements");
  });

  it("valeur stockée partiellement invalide : annonces valides conservées, écart signalé, rien perdu en silence", async () => {
    const good = { id: "5b1f3a52-9c1e-4d52-8d55-0d1c3a6f7a10", text: "Valide", href: null, kind: "ANNOUNCEMENT", isActive: true, startsAt: null, endsAt: null };
    const bad = { ...good, id: "5b1f3a52-9c1e-4d52-8d55-0d1c3a6f7a11", text: "", href: "javascript:alert(1)" };
    await db.siteSetting.create({ data: { key: "announcements", value: { items: [good, bad], rotationSeconds: 8 } } });

    const read = await getAnnouncements(db, owner);
    expect(read).toMatchObject({ items: [good], rotationSeconds: 8, dropped: 1 });

    // Une écriture ultérieure conserve l'annonce valide (et la durée) ; l'ancienne valeur reste dans l'audit.
    const added = await addAnnouncement(db, owner, DRAFT);
    const after = await getAnnouncements(db, owner);
    expect(after.items.map((item) => item.id)).toEqual([good.id, added.id]);
    expect(after).toMatchObject({ rotationSeconds: 8, dropped: 0 });
    const audit = await db.auditLog.findFirst({ where: { action: "settings.update", entityId: "announcements" } });
    expect(audit!.before).toMatchObject({ items: [good, bad] });
  });

  it("valeur stockée illisible (forme inconnue) : repli sur zéro annonce signalé, jamais d'erreur", async () => {
    await db.siteSetting.create({ data: { key: "announcements", value: "n'importe quoi" } });
    expect(await getAnnouncements(db, owner)).toMatchObject({ items: [], dropped: 1 });
  });

  it("deux ajouts simultanés sont tous deux conservés", async () => {
    const [first, second] = await Promise.all([addAnnouncement(db, owner, { ...DRAFT, text: "Première" }), addAnnouncement(db, owner, { ...DRAFT, text: "Seconde" })]);
    const { items } = await getAnnouncements(db, owner);
    expect(items.map((item) => item.id).sort()).toEqual([first.id, second.id].sort());
  });
});
