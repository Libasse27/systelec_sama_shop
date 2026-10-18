import { beforeAll, describe, expect, it } from "vitest";
import { db } from "@/server/db/client";
import { resetDatabase } from "../../../../tests/setup/db";
import { seedBaseCatalog } from "../catalog/seed";
import { getPublishedPage, listPublishedPages, toParagraphs } from "../content/queries";
import { featuredServices, getServiceDetail, listServiceGroups } from "./queries";

describe("services et contenu publics (PostgreSQL)", () => {
  beforeAll(async () => {
    await resetDatabase();
    await seedBaseCatalog(db);
  });

  it("présente les 4 familles du §7, toutes sur devis tant que les tarifs ne sont pas fixés", async () => {
    const groups = await listServiceGroups(db);
    expect(groups.map((group) => group.name)).toEqual([
      "Maintenance informatique",
      "Réseaux informatiques",
      "Vidéosurveillance",
      "Électricité",
    ]);
    const services = groups.flatMap((group) => group.services);
    expect(services).toHaveLength(41);
    expect(services.every((service) => service.pricingMode === "QUOTE_ONLY" && service.price === null)).toBe(true);
  });

  it("masque une prestation ou une famille désactivée", async () => {
    await db.service.update({ where: { slug: "diagnostic-informatique" }, data: { isActive: false } });
    expect(await getServiceDetail(db, "diagnostic-informatique")).toBeNull();

    await db.serviceCategory.update({ where: { slug: "electricite" }, data: { isActive: false } });
    expect(await getServiceDetail(db, "installation-electrique")).toBeNull();
    expect((await listServiceGroups(db)).map((group) => group.slug)).not.toContain("electricite");
    expect((await featuredServices(db, 10)).map((service) => service.slug)).not.toContain("installation-electrique");
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
