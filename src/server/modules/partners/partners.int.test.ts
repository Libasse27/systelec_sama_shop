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
import { createPartner, deletePartner, listAdminPartners, updatePartner } from "./admin";
import { listActivePartners } from "./queries";

const PNG = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 0]);
const WEBP = new Uint8Array([0x52, 0x49, 0x46, 0x46, 1, 2, 3, 4, 0x57, 0x45, 0x42, 0x50]);
const partner = (overrides: Record<string, unknown> = {}) => ({ name: "Ubiquiti", websiteUrl: "https://ui.com", isActive: true, position: 1, ...overrides });

describe("partenaires, décision 4 (PostgreSQL)", () => {
  let editor: Actor;
  let dir: string;
  let storage: FileStorage;

  beforeEach(async () => {
    await resetDatabase();
    await syncRolesAndPermissions(db);
    editor = await actorWith("ADMIN");
    dir = await mkdtemp(path.join(tmpdir(), "systelec-partenaires-"));
    storage = createLocalStorage(dir);
  });
  afterEach(() => rm(dir, { recursive: true, force: true }));

  it("création avec logo téléversé, modification, activation, ordre, suppression ; audit à chaque étape", async () => {
    const { id } = await createPartner(db, storage, editor, partner(), PNG);
    const [created] = await listAdminPartners(db, editor);
    expect(created).toMatchObject({ name: "Ubiquiti", websiteUrl: "https://ui.com", isActive: true, position: 1 });
    expect(created?.logoUrl).toMatch(/^\/medias\/partenaires\/partenaire-[a-f0-9-]{36}\.png$/);
    expect(await storage.read(keyFromMediaUrl(created!.logoUrl)!)).not.toBeNull();

    await createPartner(db, storage, editor, partner({ name: "Hikvision", websiteUrl: "", position: 0 }), WEBP);
    expect((await listActivePartners(db)).map((entry) => [entry.name, entry.websiteUrl])).toEqual([
      ["Hikvision", null],
      ["Ubiquiti", "https://ui.com"],
    ]);

    // Désactivé : retiré de la boutique ; logo conservé si aucun nouveau fichier.
    await updatePartner(db, storage, editor, id, partner({ isActive: false, position: 5 }), null);
    expect((await listActivePartners(db)).map((entry) => entry.name)).toEqual(["Hikvision"]);
    expect((await listAdminPartners(db, editor)).find((entry) => entry.id === id)?.logoUrl).toBe(created?.logoUrl);
    // Nouveau logo : remplacé.
    await updatePartner(db, storage, editor, id, partner(), WEBP);
    expect((await listAdminPartners(db, editor)).find((entry) => entry.id === id)?.logoUrl).toMatch(/\.webp$/);

    await deletePartner(db, editor, id);
    await expect(deletePartner(db, editor, id)).rejects.toMatchObject({ code: "NOT_FOUND" });
    const actions = (await db.auditLog.findMany({ where: { entityType: "Partner" }, orderBy: { createdAt: "asc" } })).map((log) => log.action);
    expect(actions).toEqual(["partner.create", "partner.create", "partner.update", "partner.update", "partner.delete"]);
    expect(await db.auditLog.findFirst({ where: { action: "partner.delete" } })).toMatchObject({ before: { name: "Ubiquiti" } });
  });

  it("aucun partenaire actif : rien à afficher", async () => {
    await createPartner(db, storage, editor, partner({ isActive: false }), PNG);
    expect(await listActivePartners(db)).toEqual([]);
  });

  it("refuse : logo absent, non image (SVG), trop lourd ; lien du site non https ; rien n'est écrit", async () => {
    await expect(createPartner(db, storage, editor, partner(), new Uint8Array())).rejects.toMatchObject({ code: "VALIDATION", details: { fieldErrors: { logo: expect.any(Array) } } });
    await expect(createPartner(db, storage, editor, partner(), new TextEncoder().encode("<svg onload=alert(1)>"))).rejects.toMatchObject({ code: "VALIDATION" });
    await expect(createPartner(db, storage, editor, partner(), new Uint8Array(1024 * 1024 + 1).fill(0x89))).rejects.toMatchObject({ code: "VALIDATION" });
    for (const websiteUrl of ["http://ui.com", "javascript:alert(1)", "ui.com", "https://ui.com@evil.example", "https://user:pass@ui.com"]) {
      await expect(createPartner(db, storage, editor, partner({ websiteUrl }), PNG)).rejects.toMatchObject({ code: "VALIDATION", details: { fieldErrors: { websiteUrl: expect.any(Array) } } });
    }
    await expect(createPartner(db, storage, editor, partner({ name: " " }), PNG)).rejects.toMatchObject({ code: "VALIDATION" });
    expect(await db.partner.count()).toBe(0);
  });

  it("en base : logo externe et lien non https interdits, même par SQL direct", async () => {
    const base = { name: "Externe", logoUrl: "/medias/partenaires/partenaire-0b6c1c55-6f9c-4b0b-9a43-5b3f0e4f7d11.png" };
    await expect(db.partner.create({ data: { ...base, logoUrl: "https://cdn.example.sn/logo.png" } })).rejects.toThrow(/partners_fields_check/);
    await expect(db.partner.create({ data: { ...base, logoUrl: "/medias/identite/logo-0b6c1c55-6f9c-4b0b-9a43-5b3f0e4f7d11.png" } })).rejects.toThrow(/partners_fields_check/);
    await expect(db.partner.create({ data: { ...base, websiteUrl: "http://exemple.sn" } })).rejects.toThrow(/partners_fields_check/);
    await db.partner.create({ data: base });
  });

  it("droits : content.manage exigé, refus journalisé", async () => {
    const finance = await actorWith("FINANCE_MANAGER");
    await expect(createPartner(db, storage, finance, partner(), PNG)).rejects.toMatchObject({ code: "FORBIDDEN" });
    await expect(listAdminPartners(db, finance)).rejects.toMatchObject({ code: "FORBIDDEN" });
    expect(await db.auditLog.count({ where: { action: "authz.denied", entityId: "content.manage" } })).toBe(2);
  });
});
