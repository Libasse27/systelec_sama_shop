import { randomUUID } from "node:crypto";
import { beforeEach, describe, expect, it } from "vitest";
import { loadAccess, type Actor } from "@/server/authz/service";
import { syncRolesAndPermissions } from "@/server/authz/sync";
import { db } from "@/server/db/client";
import { resetDatabase } from "../../../../tests/setup/db";
import { createCategory, deleteCategory, updateCategory } from "./admin-categories";
import { addVariant, createProduct, setDefaultVariant, setProductStatus, updateProduct, updateVariant } from "./admin-products";
import { getProductDetail, loadCategoryIndex } from "./queries";

async function actorWith(role: string): Promise<Actor> {
  const id = randomUUID();
  await db.user.create({
    data: { id, name: role, email: `${id}@test.sn`, kind: "STAFF", roles: { create: { role: { connect: { code: role } } } } },
  });
  return { id, ...(await loadAccess(db, id)) };
}

const productFields = (categoryId: string, overrides: Record<string, unknown> = {}) => ({
  categoryId,
  brandName: "NetMarque",
  name: "Routeur bureau AX",
  shortDescription: "Routeur Wi-Fi pour petits bureaux.",
  description: "Routeur Wi-Fi 6 double bande pour bureaux jusqu'à 30 postes.",
  specs: [{ label: "Norme", value: "Wi-Fi 6" }],
  ...overrides,
});
const variantFields = (overrides: Record<string, unknown> = {}) => ({
  sku: "rt-ax-01",
  name: "Standard",
  price: 60_000,
  costPrice: 45_000,
  ...overrides,
});

describe("administration du catalogue (§20 n° 4 et 5, PostgreSQL)", () => {
  let catalog: Actor;
  let networks: string;

  beforeEach(async () => {
    await resetDatabase();
    await syncRolesAndPermissions(db);
    catalog = await actorWith("CATALOG_MANAGER");
    networks = (await createCategory(db, catalog, { name: "Réseaux" })).id;
  });

  describe("catégories (§20 n° 5)", () => {
    it("crée une sous-catégorie avec un identifiant d'URL dérivé du nom, et l'audite", async () => {
      const { id } = await createCategory(db, catalog, { name: "Points d'accès Wi-Fi", parentId: networks });
      expect(await db.category.findUniqueOrThrow({ where: { id } })).toMatchObject({
        slug: "points-d-acces-wi-fi",
        parentId: networks,
        isActive: true,
      });
      expect(await db.auditLog.count({ where: { action: "category.create" } })).toBe(2);
    });

    it("refuse un identifiant déjà pris et une boucle dans l'arborescence", async () => {
      await expect(createCategory(db, catalog, { name: "Réseaux" })).rejects.toMatchObject({ code: "CONFLICT" });
      const child = (await createCategory(db, catalog, { name: "Switches", parentId: networks })).id;
      await expect(updateCategory(db, catalog, networks, { name: "Réseaux", parentId: child })).rejects.toMatchObject({
        code: "CONFLICT",
      });
      await expect(updateCategory(db, catalog, networks, { name: "Réseaux", parentId: networks })).rejects.toMatchObject({
        code: "CONFLICT",
      });
    });

    it("désactive une catégorie (masquée de la boutique) et ne supprime que les catégories vides", async () => {
      const child = (await createCategory(db, catalog, { name: "Câbles", parentId: networks })).id;
      await expect(deleteCategory(db, catalog, networks)).rejects.toMatchObject({ code: "CONFLICT" });
      await updateCategory(db, catalog, networks, { name: "Réseaux", isActive: false });
      expect((await loadCategoryIndex(db)).byId.has(child)).toBe(false);
      await deleteCategory(db, catalog, child);
      expect(await db.category.count({ where: { id: child } })).toBe(0);
    });

    it("refuse la gestion des catégories à un rôle non autorisé", async () => {
      const stock = await actorWith("STOCK_MANAGER");
      await expect(createCategory(db, stock, { name: "Interdite" })).rejects.toMatchObject({ code: "FORBIDDEN" });
    });
  });

  describe("produits (§20 n° 4)", () => {
    it("crée un produit en brouillon avec sa version par défaut et un stock à 0", async () => {
      const { id } = await createProduct(db, catalog, { product: productFields(networks), variant: variantFields() });
      const product = await db.product.findUniqueOrThrow({
        where: { id },
        include: { brand: true, variants: { include: { inventory: true } } },
      });
      expect(product).toMatchObject({ status: "DRAFT", slug: "routeur-bureau-ax", brand: { name: "NetMarque" } });
      expect(product.variants).toHaveLength(1);
      expect(product.variants[0]).toMatchObject({ sku: "RT-AX-01", isDefault: true, price: 60_000, costPrice: 45_000 });
      expect(product.variants[0]?.inventory).toMatchObject({ onHand: 0, reserved: 0 });
      expect(await db.auditLog.count({ where: { action: "product.create", actorId: catalog.id } })).toBe(1);
    });

    it("refuse une référence (SKU) en double, un prix décimal et un prix barré incohérent", async () => {
      await createProduct(db, catalog, { product: productFields(networks), variant: variantFields() });
      await expect(
        createProduct(db, catalog, { product: productFields(networks, { name: "Autre routeur" }), variant: variantFields() }),
      ).rejects.toMatchObject({ code: "CONFLICT" });
      await expect(
        createProduct(db, catalog, { product: productFields(networks, { name: "R2" }), variant: variantFields({ sku: "X-2", price: 99.5 }) }),
      ).rejects.toMatchObject({ code: "VALIDATION" });
      await expect(
        createProduct(db, catalog, {
          product: productFields(networks, { name: "R3" }),
          variant: variantFields({ sku: "X-3", compareAtPrice: 50_000 }),
        }),
      ).rejects.toMatchObject({ code: "VALIDATION" });
    });

    it("modifie la fiche et le prix, publie, puis archive (permission dédiée)", async () => {
      const { id } = await createProduct(db, catalog, { product: productFields(networks), variant: variantFields() });
      await updateProduct(db, catalog, id, productFields(networks, { name: "Routeur bureau AX Pro", slug: "routeur-ax-pro" }));
      const variant = await db.productVariant.findFirstOrThrow({ where: { productId: id } });
      await updateVariant(db, catalog, variant.id, variantFields({ price: 55_000, compareAtPrice: 60_000 }));
      await setProductStatus(db, catalog, id, "PUBLISHED");

      const index = await loadCategoryIndex(db);
      const detail = await getProductDetail(db, index, "routeur-ax-pro");
      expect(detail).toMatchObject({ name: "Routeur bureau AX Pro" });
      expect(detail?.variants[0]).toMatchObject({ price: 55_000, compareAtPrice: 60_000 });
      expect(JSON.stringify(detail)).not.toContain("45000");

      await setProductStatus(db, catalog, id, "ARCHIVED");
      expect(await getProductDetail(db, index, "routeur-ax-pro")).toBeNull();
      const actions = (await db.auditLog.findMany({ where: { entityId: id }, orderBy: { createdAt: "asc" } })).map((l) => l.action);
      expect(actions).toEqual(["product.create", "product.update", "product.status", "product.status"]);
    });

    it("protège la version par défaut et la cohérence d'un produit publié", async () => {
      const { id } = await createProduct(db, catalog, { product: productFields(networks), variant: variantFields() });
      const first = await db.productVariant.findFirstOrThrow({ where: { productId: id } });
      await expect(updateVariant(db, catalog, first.id, variantFields({ isActive: false }))).rejects.toMatchObject({ code: "CONFLICT" });

      const second = await addVariant(db, catalog, id, variantFields({ sku: "RT-AX-02", name: "Pack 2", price: 110_000 }));
      await setDefaultVariant(db, catalog, second.id);
      expect((await db.productVariant.findUniqueOrThrow({ where: { id: second.id } })).isDefault).toBe(true);
      expect((await db.productVariant.findUniqueOrThrow({ where: { id: first.id } })).isDefault).toBe(false);
      await updateVariant(db, catalog, first.id, variantFields({ isActive: false }));
      expect(await db.inventory.count({ where: { variantId: second.id } })).toBe(1);
    });

    it("refuse la création de produit et l'archivage aux rôles non autorisés", async () => {
      const stock = await actorWith("STOCK_MANAGER");
      await expect(createProduct(db, stock, { product: productFields(networks), variant: variantFields() })).rejects.toMatchObject({
        code: "FORBIDDEN",
      });
      const { id } = await createProduct(db, catalog, { product: productFields(networks), variant: variantFields() });
      const service = await actorWith("CUSTOMER_SERVICE");
      await expect(setProductStatus(db, service, id, "ARCHIVED")).rejects.toMatchObject({ code: "FORBIDDEN" });
    });

    it("garde une version par défaut active même si deux administrateurs agissent en même temps", async () => {
      const { id } = await createProduct(db, catalog, { product: productFields(networks), variant: variantFields() });
      for (let round = 0; round < 5; round += 1) {
        const other = await addVariant(db, catalog, id, variantFields({ sku: `RT-AX-R${round}`, name: `Version ${round}` }));
        await Promise.allSettled([
          setDefaultVariant(db, catalog, other.id),
          updateVariant(db, catalog, other.id, variantFields({ sku: `RT-AX-R${round}`, name: `Version ${round}`, isActive: false })),
        ]);
        const defaults = await db.productVariant.findMany({ where: { productId: id, isDefault: true } });
        expect(defaults).toHaveLength(1);
        expect(defaults[0]!.isActive).toBe(true);
        // Repart d'un état connu : la première version redevient la version par défaut.
        await setDefaultVariant(db, catalog, (await db.productVariant.findFirstOrThrow({ where: { productId: id, sku: "RT-AX-01" } })).id);
      }
    });

    it("réserve le désarchivage à la permission d'archivage et ignore le prix d'achat sans droit de modification", async () => {
      const { id } = await createProduct(db, catalog, { product: productFields(networks), variant: variantFields() });
      await setProductStatus(db, catalog, id, "ARCHIVED");
      const editor = { ...catalog, permissions: new Set([...catalog.permissions].filter((p) => p !== "products.archive")) };
      await expect(setProductStatus(db, editor, id, "DRAFT")).rejects.toMatchObject({ code: "FORBIDDEN" });
      expect(await db.auditLog.count({ where: { action: "authz.denied", entityId: "products.archive", result: "DENIED" } })).toBe(1);
      await setProductStatus(db, catalog, id, "DRAFT");

      const creator = { ...catalog, permissions: new Set([...catalog.permissions].filter((p) => p !== "products.update")) };
      const created = await createProduct(db, creator, {
        product: productFields(networks, { name: "Switch sans coût" }),
        variant: variantFields({ sku: "SW-NOCOST" }),
      });
      expect((await db.productVariant.findFirstOrThrow({ where: { productId: created.id } })).costPrice).toBeNull();
    });
  });
});
