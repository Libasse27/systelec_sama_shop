import { beforeEach, describe, expect, it } from "vitest";
import type { Actor } from "@/server/authz/service";
import { syncRolesAndPermissions } from "@/server/authz/sync";
import { db } from "@/server/db/client";
import { resetDatabase } from "../../../../tests/setup/db";
import { actorWith } from "../../../../tests/support/actors";
import { deleteFaqItem, listAdminFaq, listAdminPages, saveFaqItem, savePage } from "./admin";
import { getPublishedPage, listFaq } from "./queries";

const body = "Livraison à Dakar sous 24 à 48 heures.\n\nRetrait gratuit en boutique.";

describe("administration du contenu (PostgreSQL)", () => {
  let editor: Actor;

  beforeEach(async () => {
    await resetDatabase();
    await syncRolesAndPermissions(db);
    editor = await actorWith("ADMIN");
  });

  it("crée une page en brouillon, la publie, la modifie ; audit avant/après", async () => {
    const { id } = await savePage(db, editor, null, { slug: "livraison", title: "Livraison", body: "", isPublished: false });
    expect(await getPublishedPage(db, "livraison")).toBeNull();
    await expect(savePage(db, editor, id, { slug: "livraison", title: "Livraison", body: "Court", isPublished: true })).rejects.toMatchObject({ code: "VALIDATION" });
    await savePage(db, editor, id, { slug: "livraison", title: "Livraison et retrait", body, seoDescription: "Délais", isPublished: true });
    expect(await getPublishedPage(db, "livraison")).toMatchObject({ title: "Livraison et retrait", body, seoDescription: "Délais" });
    const logs = await db.auditLog.findMany({ where: { entityType: "Page", entityId: id }, orderBy: { createdAt: "asc" } });
    expect(logs.map((log) => log.action)).toEqual(["page.create", "page.update"]);
    expect(logs[1]?.before).toMatchObject({ title: "Livraison", isPublished: false });
    expect((await listAdminPages(db, editor)).map((page) => page.slug)).toEqual(["livraison"]);
  });

  it("refuse une adresse invalide ou déjà prise", async () => {
    await expect(savePage(db, editor, null, { slug: "../admin", title: "X", body, isPublished: false })).rejects.toMatchObject({ code: "VALIDATION" });
    await savePage(db, editor, null, { slug: "cgv", title: "CGV", body, isPublished: false });
    await expect(savePage(db, editor, null, { slug: "CGV", title: "Autre", body, isPublished: false })).rejects.toMatchObject({ code: "CONFLICT" });
  });

  it("FAQ : ajout, modification, masquage, suppression auditée", async () => {
    await saveFaqItem(db, editor, null, { question: "Livrez-vous à Thiès ?", answer: "Oui, sur devis.", position: 1, isPublished: true });
    const [item] = await listAdminFaq(db, editor);
    await saveFaqItem(db, editor, item!.id, { question: "Livrez-vous à Thiès ?", answer: "Oui, sur devis.", position: 1, isPublished: false });
    expect(await listFaq(db)).toEqual([]);
    await deleteFaqItem(db, editor, item!.id);
    expect(await db.auditLog.findFirst({ where: { action: "faq.delete" } })).toMatchObject({ before: { question: "Livrez-vous à Thiès ?" } });
    await expect(deleteFaqItem(db, editor, item!.id)).rejects.toMatchObject({ code: "NOT_FOUND" });
  });

  it("droits : content.manage exigé, refus journalisé", async () => {
    const finance = await actorWith("FINANCE_MANAGER");
    await expect(savePage(db, finance, null, { slug: "x", title: "X", body, isPublished: false })).rejects.toMatchObject({ code: "FORBIDDEN" });
    await expect(listAdminFaq(db, finance)).rejects.toMatchObject({ code: "FORBIDDEN" });
    expect(await db.auditLog.count({ where: { action: "authz.denied", entityId: "content.manage" } })).toBe(2);
  });
});
