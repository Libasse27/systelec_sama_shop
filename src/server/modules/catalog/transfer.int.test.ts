import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { parseCsv } from "@/lib/csv";
import type { Actor } from "@/server/authz/service";
import { syncRolesAndPermissions } from "@/server/authz/sync";
import { db } from "@/server/db/client";
import { listInventory } from "@/server/modules/inventory/queries";
import { recordStockMovement } from "@/server/modules/inventory/service";
import { createLocalStorage, keyFromMediaUrl, type FileStorage } from "@/server/storage/storage";
import { resetDatabase } from "../../../../tests/setup/db";
import { actorWith } from "../../../../tests/support/actors";
import { createCategory } from "./admin-categories";
import { addProductImage, deleteProductImage, MAX_IMAGES_PER_PRODUCT, moveProductImage } from "./admin-images";
import { createProduct } from "./admin-products";
import { getAdminProduct, listAdminProducts } from "./admin-queries";
import { applyCatalogImport, exportCatalogCsv, IMPORT_COUNT_REASON, previewCatalogImport } from "./csv-transfer";

const PNG = Uint8Array.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 0]);

async function newProduct(actor: Actor, categoryId: string, sku: string, name = `Produit ${sku}`) {
  return createProduct(db, actor, {
    product: { categoryId, name, shortDescription: "Description courte.", description: "Description longue du produit." },
    variant: { sku, name: "Standard", price: 10_000, costPrice: 7_000 },
  });
}

describe("catalogue : images, listes, import/export CSV (§20 n° 4 et 6, PostgreSQL)", () => {
  let catalog: Actor;
  let stock: Actor;
  let categoryId: string;

  beforeEach(async () => {
    await resetDatabase();
    await syncRolesAndPermissions(db);
    catalog = await actorWith("CATALOG_MANAGER");
    stock = await actorWith("STOCK_MANAGER");
    categoryId = (await createCategory(db, catalog, { name: "Réseaux" })).id;
  });

  describe("images", () => {
    let dir: string;
    let storage: FileStorage;
    beforeEach(async () => {
      dir = await mkdtemp(path.join(tmpdir(), "sama-images-"));
      storage = createLocalStorage(dir);
    });
    afterEach(() => rm(dir, { recursive: true, force: true }));

    it("téléverse, réordonne puis supprime les images (fichier compris)", async () => {
      const { id } = await newProduct(catalog, categoryId, "IMG-1");
      const first = await addProductImage(db, storage, catalog, id, { bytes: PNG, alt: "Vue de face" });
      const second = await addProductImage(db, storage, catalog, id, { bytes: PNG, alt: "Vue de dos" });
      await moveProductImage(db, catalog, second.id, "up");
      expect((await getAdminProduct(db, catalog, id))?.images.map((image) => image.alt)).toEqual(["Vue de dos", "Vue de face"]);

      const { url } = await db.productImage.findUniqueOrThrow({ where: { id: first.id } });
      expect(url).toMatch(/^\/medias\/produits\/[a-z0-9]+\/[0-9a-f-]+\.png$/);
      expect(await storage.read(keyFromMediaUrl(url)!)).not.toBeNull();
      await deleteProductImage(db, storage, catalog, first.id);
      expect(await storage.read(keyFromMediaUrl(url)!)).toBeNull();
      expect(await db.auditLog.count({ where: { action: { startsWith: "product.image." } } })).toBe(4);
    });

    it("refuse un faux fichier image, une image sans description, et au-delà de la limite", async () => {
      const { id } = await newProduct(catalog, categoryId, "IMG-2");
      const svg = new TextEncoder().encode("<svg onload='alert(1)'/>");
      await expect(addProductImage(db, storage, catalog, id, { bytes: svg, alt: "Logo" })).rejects.toMatchObject({ code: "VALIDATION" });
      await expect(addProductImage(db, storage, catalog, id, { bytes: PNG, alt: "" })).rejects.toMatchObject({ code: "VALIDATION" });
      await expect(addProductImage(db, storage, stock, id, { bytes: PNG, alt: "Vue" })).rejects.toMatchObject({ code: "FORBIDDEN" });
      for (let i = 0; i < MAX_IMAGES_PER_PRODUCT; i += 1) await addProductImage(db, storage, catalog, id, { bytes: PNG, alt: `Vue ${i}` });
      await expect(addProductImage(db, storage, catalog, id, { bytes: PNG, alt: "En trop" })).rejects.toMatchObject({ code: "CONFLICT" });
    });
  });

  it("liste les produits de tout statut avec recherche par SKU et stock disponible", async () => {
    await newProduct(catalog, categoryId, "RT-01", "Routeur AX");
    const { id } = await newProduct(catalog, categoryId, "SW-02", "Switch 8 ports");
    const variantId = (await db.productVariant.findUniqueOrThrow({ where: { sku: "SW-02" } })).id;
    await recordStockMovement(db, stock, { variantId, type: "IN", quantity: 4, reason: "Réception" });

    const page = await listAdminProducts(db, stock, { q: "sw-0" });
    expect(page.rows).toEqual([expect.objectContaining({ id, status: "DRAFT", sku: "SW-02", onHand: 4, available: 4, hasImage: false })]);
    expect((await listAdminProducts(db, stock, { status: "PUBLISHED" })).total).toBe(0);

    const inventory = await listInventory(db, stock, { alertsOnly: true });
    expect(inventory.rows.map((row) => row.sku)).toEqual(["RT-01"]);
  });

  it("exporte une ligne par version, sans prix d'achat pour qui ne peut pas modifier les produits", async () => {
    await newProduct(catalog, categoryId, "RT-01", "=Routeur cmd");
    const [header, row] = parseCsv(await exportCatalogCsv(db, catalog));
    expect(header).toContain("prix_achat");
    expect(row).toEqual(["RT-01", "'=Routeur cmd", "Standard", "reseaux", "", "brouillon", "oui", "10000", "", "7000", "0", "0", "0", ""]);
    expect(parseCsv(await exportCatalogCsv(db, stock))[0]).not.toContain("prix_achat");
  });

  it("applique prix et inventaire en une transaction, avec mouvement de stock motivé", async () => {
    await newProduct(catalog, categoryId, "RT-01");
    const csv = "sku;prix;prix_barre;stock_compte\nRT-01;9000;12000;\n";
    expect((await previewCatalogImport(db, catalog, csv)).changes).toHaveLength(1);
    expect(await applyCatalogImport(db, catalog, csv)).toEqual({ updated: 1 });
    expect(await db.productVariant.findUniqueOrThrow({ where: { sku: "RT-01" } })).toMatchObject({ price: 9000, compareAtPrice: 12_000 });

    await applyCatalogImport(db, stock, "sku;stock_compte\nRT-01;7\n");
    const variant = await db.productVariant.findUniqueOrThrow({ where: { sku: "RT-01" }, include: { inventory: true, movements: true } });
    expect(variant.inventory).toMatchObject({ onHand: 7, lastCountedQty: 7 });
    expect(variant.movements).toEqual([expect.objectContaining({ type: "ADJUSTMENT", quantity: 7, reason: IMPORT_COUNT_REASON, actorId: stock.id })]);
    expect(await db.auditLog.count({ where: { action: "catalog.import" } })).toBe(2);
  });

  it("n'applique rien si une ligne est fausse, et vérifie les droits selon les colonnes modifiées", async () => {
    await newProduct(catalog, categoryId, "RT-01");
    await newProduct(catalog, categoryId, "SW-02");
    await expect(applyCatalogImport(db, catalog, "sku;prix\nRT-01;5000\nSW-02;abc\n")).rejects.toMatchObject({ code: "VALIDATION" });
    expect((await db.productVariant.findUniqueOrThrow({ where: { sku: "RT-01" } })).price).toBe(10_000);

    await expect(applyCatalogImport(db, stock, "sku;prix\nRT-01;5000\n")).rejects.toMatchObject({ code: "FORBIDDEN" });
    await expect(applyCatalogImport(db, catalog, "sku;stock_compte\nRT-01;5\n")).rejects.toMatchObject({ code: "FORBIDDEN" });
    // Prix d'achat inchangé : refusé quand même, sinon l'aperçu confirmerait une valeur devinée.
    await expect(previewCatalogImport(db, stock, "sku;prix_achat\nRT-01;7000\n")).rejects.toMatchObject({ code: "FORBIDDEN" });
    expect((await previewCatalogImport(db, stock, "sku;prix_achat;stock_compte\nRT-01;;3\n")).changes).toHaveLength(1);
    expect(await db.stockMovement.count()).toBe(0);
  });
});
