import { beforeAll, describe, expect, it } from "vitest";
import { db } from "@/server/db/client";
import { resetDatabase } from "../../../../tests/setup/db";
import { seedDemoCatalog } from "./demo";
import { parseListingParams } from "./listing-params";
import {
  brandsInScope,
  categoryPath,
  descendantIds,
  featuredProducts,
  getProductDetail,
  listProductsForSitemap,
  loadCategoryIndex,
  searchProducts,
  type CategoryIndex,
} from "./queries";
import { seedBaseCatalog } from "./seed";

let index: CategoryIndex;
const allIds = () => [...index.byId.keys()];
const search = (raw: Record<string, string> = {}, scope = allIds()) => searchProducts(db, scope, parseListingParams(raw));
const names = (items: { name: string }[]) => items.map((item) => item.name);
const scopeOf = (slug: string) => descendantIds(index, index.bySlug.get(slug)!.id);

describe("catalogue public (PostgreSQL)", () => {
  beforeAll(async () => {
    await resetDatabase();
    await seedBaseCatalog(db);
    await seedDemoCatalog(db);
    index = await loadCategoryIndex(db);
  });

  it("construit l'arborescence §6 et le fil d'Ariane", () => {
    expect(index.children.get(null)?.map((c) => c.name)).toEqual([
      "Informatique",
      "Réseaux et télécommunications",
      "Électronique grand public",
      "Vidéosurveillance et sécurité",
      "Électricité et énergie",
      "Accessoires et consommables",
    ]);
    const laptops = index.bySlug.get("ordinateurs-portables")!;
    expect(categoryPath(index, laptops.id).map((c) => c.slug)).toEqual(["informatique", "ordinateurs-portables"]);
    expect(scopeOf("informatique")).toContain(laptops.id);
  });

  it("ne liste que les produits publiés", async () => {
    const page = await search();
    expect(page.total).toBe(12);
    expect(names(page.items).some((name) => name.includes("brouillon"))).toBe(false);
  });

  it("recherche sans tenir compte des accents ni de la casse", async () => {
    expect(names((await search({ q: "camera" })).items)).toEqual(["[DÉMO] Caméra IP extérieure 4 MP"]);
    expect(names((await search({ q: "ECRAN" })).items)).toEqual(["[DÉMO] Écran 24 pouces IPS"]);
  });

  it("recherche par SKU, par marque, par catégorie et par plusieurs mots", async () => {
    expect(names((await search({ q: "demo-ndax3" })).items)).toEqual(["[DÉMO] Routeur Wi-Fi 6 double bande"]);
    expect((await search({ q: "vigidemo" })).total).toBe(2);
    expect((await search({ q: "switches" })).total).toBe(1);
    expect(names((await search({ q: "routeur wi-fi" })).items)).toEqual(["[DÉMO] Routeur Wi-Fi 6 double bande"]);
  });

  it("échappe les jokers SQL de la recherche", async () => {
    expect((await search({ q: "%" })).total).toBe(0);
    expect((await search({ q: "_" })).total).toBe(0);
  });

  it("filtre par catégorie (sous-catégories incluses), marque, prix et disponibilité", async () => {
    const informatique = await search({}, scopeOf("informatique"));
    expect(informatique.total).toBe(4);
    expect(names(informatique.items).some((name) => name.includes("Routeur"))).toBe(false);

    expect((await search({ marque: "netdemo" })).total).toBe(3);
    const priced = await search({ min: "40000", max: "100000" });
    expect(priced.items.every((item) => item.price >= 40_000 && item.price <= 100_000)).toBe(true);
    const inStock = await search({ dispo: "1" });
    expect(inStock.total).toBe(11);
    expect(names(inStock.items)).not.toContain("[DÉMO] Écran 24 pouces IPS");
  });

  it("trie par prix et pagine", async () => {
    const ascending = (await search({ tri: "prix-croissant" })).items.map((item) => item.price);
    expect(ascending).toEqual([...ascending].sort((a, b) => a - b));
    const descending = (await search({ tri: "prix-decroissant" })).items.map((item) => item.price);
    expect(descending[0]).toBe(385_000);
    const beyond = await search({ page: "5" });
    expect(beyond).toMatchObject({ items: [], total: 12, pageCount: 1 });
  });

  it("calcule la disponibilité depuis le stock (épuisé = 0)", async () => {
    const [screen] = (await search({ q: "ecran" })).items;
    expect(screen?.available).toBe(0);
    const [laptop] = (await search({ q: "15 pouces" })).items;
    expect(laptop?.available).toBe(6);
  });

  it("propose les marques du périmètre et les produits mis en avant", async () => {
    expect((await brandsInScope(db, scopeOf("reseaux-et-telecommunications"))).map((b) => b.slug)).toEqual(["netdemo"]);
    const featured = await featuredProducts(db, allIds(), 10);
    expect(featured).toHaveLength(4);
  });

  it("n'expose jamais le prix d'achat dans une fiche produit (§6)", async () => {
    const detail = await getProductDetail(db, index, "demo-ordinateur-portable-15-pouces-pro");
    expect(detail).not.toBeNull();
    expect(JSON.stringify(detail)).not.toMatch(/costPrice|300000|360000/);
    expect(detail?.variants.map((v) => [v.sku, v.price, v.available])).toEqual([
      ["DEMO-DT15P-8", 385_000, 4],
      ["DEMO-DT15P-16", 465_000, 2],
    ]);
    const cards = await search();
    expect(JSON.stringify(cards)).not.toContain("costPrice");
  });

  it("présente les accessoires compatibles publiés", async () => {
    const router = await getProductDetail(db, index, "demo-routeur-wi-fi-6-double-bande");
    expect(router?.compatible.map((p) => p.slug)).toEqual(["demo-cable-ethernet-cat6-20-m"]);
  });

  it("affiche la même variante dans la liste et la fiche quand la variante par défaut est désactivée", async () => {
    const slug = "demo-ordinateur-portable-15-pouces-pro";
    await db.productVariant.update({ where: { sku: "DEMO-DT15P-8" }, data: { isActive: false } });
    try {
      const [card] = (await search({ q: "15 pouces" })).items;
      expect(card?.price).toBe(465_000);
      const detail = await getProductDetail(db, index, slug);
      expect(detail?.variants.map((v) => v.sku)).toEqual(["DEMO-DT15P-16"]);
      expect((await listProductsForSitemap(db, index)).map((p) => p.slug)).toContain(slug);
    } finally {
      await db.productVariant.update({ where: { sku: "DEMO-DT15P-8" }, data: { isActive: true } });
    }
  });

  it("retire des listes, de la fiche et du sitemap un produit sans variante active", async () => {
    const slug = "demo-cle-usb-64-go";
    await db.productVariant.update({ where: { sku: "DEMO-USB64" }, data: { isActive: false } });
    try {
      expect((await search({ q: "usb" })).total).toBe(0);
      expect(await getProductDetail(db, index, slug)).toBeNull();
      expect((await listProductsForSitemap(db, index)).map((p) => p.slug)).not.toContain(slug);
    } finally {
      await db.productVariant.update({ where: { sku: "DEMO-USB64" }, data: { isActive: true } });
    }
  });

  it("répond « introuvable » à un identifiant d'URL invalide sans interroger la base en erreur", async () => {
    await expect(getProductDetail(db, index, "a\u0000b")).resolves.toBeNull();
    await expect(getProductDetail(db, index, "x".repeat(500))).resolves.toBeNull();
  });

  it("masque un brouillon et le contenu d'une catégorie désactivée (y compris via son parent)", async () => {
    expect(await getProductDetail(db, index, "demo-tablette-10-pouces-brouillon")).toBeNull();

    await db.category.update({ where: { slug: "informatique" }, data: { isActive: false } });
    try {
      const hidden = await loadCategoryIndex(db);
      expect(hidden.bySlug.has("ordinateurs-portables")).toBe(false);
      expect(await getProductDetail(db, hidden, "demo-ordinateur-portable-15-pouces-pro")).toBeNull();
      expect((await searchProducts(db, [...hidden.byId.keys()], parseListingParams({}))).total).toBe(8);
    } finally {
      await db.category.update({ where: { slug: "informatique" }, data: { isActive: true } });
    }
  });
});
