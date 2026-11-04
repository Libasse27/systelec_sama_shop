import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { Actor } from "@/server/authz/service";
import { syncRolesAndPermissions } from "@/server/authz/sync";
import { db } from "@/server/db/client";
import { createLocalStorage, keyFromMediaUrl, type FileStorage } from "@/server/storage/storage";
import { resetDatabase } from "../../../../tests/setup/db";
import { actorWith } from "../../../../tests/support/actors";
import { getAllSettings, isSettingKey, removeLogo, saveSettings, uploadLogo } from "./admin";
import { settingsDefaults } from "./schemas";
import { getSetting } from "./service";

const PNG = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 0]);

describe("administration des paramètres (PostgreSQL)", () => {
  let admin: Actor;
  let dir: string;
  let storage: FileStorage;

  beforeEach(async () => {
    await resetDatabase();
    await syncRolesAndPermissions(db);
    admin = await actorWith("ADMIN");
    dir = await mkdtemp(path.join(tmpdir(), "systelec-logo-"));
    storage = createLocalStorage(dir);
  });

  afterEach(() => rm(dir, { recursive: true, force: true }));

  it("mentions légales (D7), invité (D1), partiel (D2), réservation (D3), TVA (D6), avis (D8) : validés et audités", async () => {
    await saveSettings(db, admin, "company", { ...settingsDefaults.company, ninea: "0012345 2G3", rccm: "SN-DKR-2026-B-1234" });
    await saveSettings(db, admin, "commerce", { ...settingsDefaults.commerce, guestCheckoutEnabled: false, partialPaymentEnabled: true, stockReservationHours: 24 });
    await saveSettings(db, admin, "tax", { vatDetailEnabled: true, vatRate: 18 });
    await saveSettings(db, admin, "features", { reviewsEnabled: false });
    const all = await getAllSettings(db, admin);
    expect(all.company).toMatchObject({ ninea: "0012345 2G3", rccm: "SN-DKR-2026-B-1234" });
    expect(all.commerce).toMatchObject({ guestCheckoutEnabled: false, partialPaymentEnabled: true, stockReservationHours: 24 });
    expect(all.tax.vatDetailEnabled).toBe(true);
    expect(await db.auditLog.count({ where: { action: "settings.update", actorId: admin.id } })).toBe(4);
  });

  it("erreurs rattachées au champ, rien d'écrit ; aucune clé inconnue acceptée", async () => {
    await expect(saveSettings(db, admin, "commerce", { ...settingsDefaults.commerce, stockReservationHours: 0 })).rejects.toMatchObject({
      code: "VALIDATION",
      details: { fieldErrors: { stockReservationHours: expect.any(Array) } },
    });
    await expect(saveSettings(db, admin, "payments", { enabledMethods: ["CASH_ON_PICKUP"], cleInconnue: "x" })).rejects.toMatchObject({ code: "VALIDATION" });
    await expect(saveSettings(db, admin, "company", { ...settingsDefaults.company, socialLinks: { ...settingsDefaults.company.socialLinks, facebook: "javascript:alert(1)" } })).rejects.toMatchObject({
      details: { fieldErrors: { "socialLinks.facebook": expect.any(Array) } },
    });
    expect(await db.siteSetting.count()).toBe(0);
  });

  it("réseaux sociaux : un nouveau lien non conforme est refusé sur son champ, rien n'est écrit", async () => {
    const links = settingsDefaults.company.socialLinks;
    for (const [network, href] of [["youtube", "http://youtube.com/futani"], ["x", "https://user:pw@x.com/futani"], ["tiktok", "javascript:alert(1)"]] as const) {
      await expect(saveSettings(db, admin, "company", { ...settingsDefaults.company, socialLinks: { ...links, [network]: href } })).rejects.toMatchObject({
        code: "VALIDATION",
        details: { fieldErrors: { [`socialLinks.${network}`]: expect.any(Array) } },
      });
    }
    // Erreurs des champs ordinaires et des liens renvoyées ensemble.
    await expect(saveSettings(db, admin, "company", { ...settingsDefaults.company, companyName: "", socialLinks: { ...links, x: "https://t.co/abc" } })).rejects.toMatchObject({
      details: { fieldErrors: { companyName: expect.any(Array), "socialLinks.x": expect.any(Array) } },
    });
    expect(await db.siteSetting.count()).toBe(0);
  });

  describe("réseaux sociaux : anciens liens non conformes déjà en base", () => {
    const legacyLinks = {
      facebook: "javascript:alert(1)",
      instagram: "https://www.instagram.com/futani",
      linkedin: "linkedin.com/company/futani",
      tiktok: "https://vm.tiktok.com/ZMabc",
      youtube: "http://youtube.com/futani",
      // Espaces autour : le formulaire renvoie la valeur nettoyée, la valeur brute doit rester intacte.
      x: "  https://t.co/abc ",
    };
    /** Ce que renvoie le formulaire : les valeurs affichées dans les champs, sans espaces autour. */
    const submittedLinks = { ...legacyLinks, x: "https://t.co/abc" };
    const rawStoredLinks = async () => ((await db.siteSetting.findUniqueOrThrow({ where: { key: "company" } })).value as { socialLinks: unknown }).socialLinks;
    // Valeur enregistrée avant le durcissement (écrite directement, comme une donnée historique).
    beforeEach(() => db.siteSetting.create({ data: { key: "company", value: { ...settingsDefaults.company, socialLinks: legacyLinks } } }));

    it("restent lisibles (écran Paramètres, pied de page) sans rien perdre", async () => {
      expect((await getAllSettings(db, admin)).company.socialLinks).toEqual(legacyLinks);
      expect((await getSetting("company")).socialLinks).toEqual(legacyLinks);
    });

    it("n'empêchent pas d'enregistrer le nom, l'adresse, le téléphone et les autres informations ; ils sont conservés tels quels", async () => {
      const { logoUrl } = await uploadLogo(db, storage, admin, PNG);
      const saved = await saveSettings(db, admin, "company", {
        ...settingsDefaults.company,
        companyName: "SYSTELEC SARL",
        address: "Dakar, Plateau",
        phone: "+221 33 000 00 00",
        email: "contact@example.sn",
        socialLinks: submittedLinks,
      });
      expect(saved).toMatchObject({ companyName: "SYSTELEC SARL", address: "Dakar, Plateau", phone: "+221 33 000 00 00", logoUrl, socialLinks: legacyLinks });
      expect(await getSetting("company")).toEqual(saved);
      expect(await rawStoredLinks()).toEqual(legacyLinks);
      const audit = await db.auditLog.findFirst({ where: { action: "settings.update", entityId: "company" }, orderBy: { createdAt: "desc" } });
      expect(audit?.after).toMatchObject({ companyName: "SYSTELEC SARL", socialLinks: legacyLinks });
    });

    it("se corrigent un par un : le lien corrigé est enregistré, les autres restent inchangés", async () => {
      const saved = await saveSettings(db, admin, "company", { ...settingsDefaults.company, socialLinks: { ...submittedLinks, youtube: "https://www.youtube.com/@futani" } });
      expect(saved.socialLinks).toEqual({ ...legacyLinks, youtube: "https://www.youtube.com/@futani" });
      expect(await rawStoredLinks()).toEqual({ ...legacyLinks, youtube: "https://www.youtube.com/@futani" });
    });

    it("un ancien lien remplacé par une autre adresse non conforme est refusé sur son seul champ, rien n'est écrit", async () => {
      await expect(saveSettings(db, admin, "company", { ...settingsDefaults.company, companyName: "Autre", socialLinks: { ...submittedLinks, tiktok: "https://vt.tiktok.com/autre" } })).rejects.toMatchObject({
        code: "VALIDATION",
        details: { fieldErrors: { "socialLinks.tiktok": expect.any(Array) } },
      });
      expect((await getSetting("company")).companyName).toBe(settingsDefaults.company.companyName);
      expect(await db.auditLog.count({ where: { action: "settings.update", entityId: "company" } })).toBe(0);
      expect(await rawStoredLinks()).toEqual(legacyLinks);
    });

    it("vider un champ efface seulement ce lien", async () => {
      const saved = await saveSettings(db, admin, "company", { ...settingsDefaults.company, socialLinks: { ...submittedLinks, facebook: null } });
      expect(saved.socialLinks).toEqual({ ...legacyLinks, facebook: null });
      expect(await rawStoredLinks()).toEqual({ ...legacyLinks, facebook: null });
    });
  });

  it("droits : settings.manage exigé, refus journalisé", async () => {
    const finance = await actorWith("FINANCE_MANAGER");
    await expect(saveSettings(db, finance, "tax", { vatDetailEnabled: true, vatRate: 18 })).rejects.toMatchObject({ code: "FORBIDDEN" });
    await expect(getAllSettings(db, finance)).rejects.toMatchObject({ code: "FORBIDDEN" });
    await expect(uploadLogo(db, storage, finance, PNG)).rejects.toMatchObject({ code: "FORBIDDEN" });
    expect(await db.auditLog.count({ where: { action: "authz.denied", entityId: "settings.manage" } })).toBe(3);
  });

  it("logo (D13) : image vérifiée sur son contenu, nom aléatoire, retrait possible", async () => {
    await expect(uploadLogo(db, storage, admin, new TextEncoder().encode("<svg onload=alert(1)>"))).rejects.toMatchObject({ code: "VALIDATION" });
    await expect(uploadLogo(db, storage, admin, new Uint8Array())).rejects.toMatchObject({ code: "VALIDATION" });
    await expect(uploadLogo(db, storage, admin, new Uint8Array(1024 * 1024 + 1).fill(0x89))).rejects.toMatchObject({ code: "VALIDATION" });

    const { logoUrl } = await uploadLogo(db, storage, admin, PNG);
    expect(logoUrl).toMatch(/^\/medias\/identite\/logo-[a-f0-9-]{36}\.png$/);
    expect(await storage.read(keyFromMediaUrl(logoUrl)!)).not.toBeNull();
    expect((await getSetting("company")).logoUrl).toBe(logoUrl);

    // L'identité ne change pas le logo : une adresse soumise (même externe) est ignorée.
    await saveSettings(db, admin, "company", { ...settingsDefaults.company, logoUrl: "https://cdn.example.sn/logo.png", ninea: "123" });
    expect((await getSetting("company")).logoUrl).toBe(logoUrl);

    await removeLogo(db, admin);
    expect((await getSetting("company")).logoUrl).toBeNull();
    await expect(removeLogo(db, admin)).rejects.toMatchObject({ code: "CONFLICT" });
  });

  it("décision 4 : un logo externe est refusé, y compris directement en base", async () => {
    await saveSettings(db, admin, "company", { ...settingsDefaults.company, logoUrl: "https://cdn.example.sn/logo.png" });
    expect((await getSetting("company")).logoUrl).toBeNull();
    await expect(
      db.siteSetting.create({ data: { key: "company", value: { ...settingsDefaults.company, logoUrl: "https://cdn.example.sn/logo.png" } } }),
    ).rejects.toThrow(/site_settings_logo_check/);
  });

  it("isSettingKey refuse « announcements » (relève de announcements.manage)", () => {
    expect(isSettingKey("announcements")).toBe(false);
    expect(isSettingKey("tax")).toBe(true);
  });

  it("heures ouvrables (décision 2) : validées et auditées", async () => {
    await saveSettings(db, admin, "businessHours", { days: [1, 2, 3, 4, 5], ranges: [{ start: "08:00", end: "13:00" }, { start: "15:00", end: "18:00" }] });
    expect((await getAllSettings(db, admin)).businessHours.ranges).toHaveLength(2);
    await expect(saveSettings(db, admin, "businessHours", { days: [], ranges: [{ start: "08:00", end: "18:00" }] })).rejects.toMatchObject({
      details: { fieldErrors: { days: expect.any(Array) } },
    });
    expect(await db.auditLog.count({ where: { action: "settings.update", entityId: "businessHours" } })).toBe(1);
  });
});
