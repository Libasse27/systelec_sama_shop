import { beforeAll, describe, expect, it } from "vitest";
import { db } from "@/server/db/client";
import { resetDatabase } from "../../../../tests/setup/db";
import { seedBaseCatalog } from "../catalog/seed";
import { getPublishedPage, listPublishedPages, toParagraphs } from "../content/queries";
import { getServiceDetail, getServiceGroup, listServiceGroups } from "./queries";

describe("services et contenu publics (PostgreSQL)", () => {
  beforeAll(async () => {
    await resetDatabase();
    await seedBaseCatalog(db);
  });

  it("présente les 5 familles (4 du §7 et le développement web), toutes sur devis tant que les tarifs ne sont pas fixés", async () => {
    const groups = await listServiceGroups(db);
    expect(groups.map((group) => group.name)).toEqual([
      "Maintenance informatique",
      "Réseaux informatiques",
      "Vidéosurveillance",
      "Électricité",
      "Développement web",
    ]);
    const services = groups.flatMap((group) => group.services);
    expect(services).toHaveLength(42);
    // Slug réservé au segment des pages de famille (/services/categorie/[slug]).
    expect(services.map((service) => service.slug)).not.toContain("categorie");
    expect(services.every((service) => service.pricingMode === "QUOTE_ONLY" && service.price === null)).toBe(true);
  });

  it("lit une famille et ses prestations dans leur ordre, et refuse un slug inconnu ou invalide", async () => {
    const group = await getServiceGroup(db, "videosurveillance");
    expect(group?.name).toBe("Vidéosurveillance");
    expect(group?.services).toHaveLength(10);
    expect(group?.services[0]?.slug).toBe("etude-de-site");
    expect(await getServiceGroup(db, "inconnue")).toBeNull();
    expect(await getServiceGroup(db, "../videosurveillance")).toBeNull();
  });

  it("ne présente pas une famille dont toutes les prestations sont désactivées", async () => {
    await db.service.updateMany({ where: { category: { slug: "developpement-web" } }, data: { isActive: false } });
    expect(await getServiceGroup(db, "developpement-web")).toBeNull();
    await db.service.updateMany({ where: { category: { slug: "developpement-web" } }, data: { isActive: true } });
    expect(await getServiceGroup(db, "developpement-web")).not.toBeNull();
  });

  it("masque une prestation ou une famille désactivée", async () => {
    await db.service.update({ where: { slug: "diagnostic-informatique" }, data: { isActive: false } });
    expect(await getServiceDetail(db, "diagnostic-informatique")).toBeNull();
    expect((await getServiceGroup(db, "maintenance-informatique"))?.services.map((service) => service.slug)).not.toContain(
      "diagnostic-informatique",
    );

    await db.serviceCategory.update({ where: { slug: "electricite" }, data: { isActive: false } });
    expect(await getServiceDetail(db, "installation-electrique")).toBeNull();
    expect(await getServiceGroup(db, "electricite")).toBeNull();
    expect((await listServiceGroups(db)).map((group) => group.slug)).not.toContain("electricite");
  });

  it("refuse un tarif manquant pour une prestation à prix fixe (contrainte en base)", async () => {
    await expect(
      db.service.update({ where: { slug: "cablage-reseau" }, data: { pricingMode: "FIXED", price: null } }),
    ).rejects.toThrow();
  });

  it("ne sert jamais une page en brouillon", async () => {
    expect(await getPublishedPage(db, "conditions-generales-de-vente")).toBeNull();
    expect(await listPublishedPages(db)).toEqual([]);
    await db.page.update({ where: { slug: "a-propos" }, data: { isPublished: true, body: "Premier.\n\nSecond." } });
    expect(toParagraphs((await getPublishedPage(db, "a-propos"))!.body)).toEqual(["Premier.", "Second."]);
  });
});
