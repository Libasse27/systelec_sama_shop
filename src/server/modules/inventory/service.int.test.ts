import { randomUUID } from "node:crypto";
import { beforeEach, describe, expect, it } from "vitest";
import { syncRolesAndPermissions } from "@/server/authz/sync";
import { loadAccess, type Actor } from "@/server/authz/service";
import { db } from "@/server/db/client";
import { resetDatabase } from "../../../../tests/setup/db";
import { listStockAlerts, recordStockMovement, setAlertThreshold } from "./service";

async function actorWith(role: string): Promise<Actor> {
  const id = randomUUID();
  await db.user.create({
    data: { id, name: role, email: `${id}@test.sn`, kind: "STAFF", roles: { create: { role: { connect: { code: role } } } } },
  });
  return { id, ...(await loadAccess(db, id)) };
}

async function createVariant(onHand: number, reserved = 0): Promise<string> {
  const category = await db.category.create({ data: { name: "Cat", slug: `cat-${randomUUID()}` } });
  const product = await db.product.create({
    data: {
      name: "Produit",
      slug: `p-${randomUUID()}`,
      categoryId: category.id,
      shortDescription: "Court",
      description: "Long",
      variants: {
        create: {
          sku: `SKU-${randomUUID()}`,
          name: "Standard",
          price: 10_000,
          isDefault: true,
          inventory: { create: { onHand, reserved, alertThreshold: 2 } },
        },
      },
    },
    include: { variants: true },
  });
  return product.variants[0]!.id;
}

const stock = (variantId: string) => db.inventory.findUniqueOrThrow({ where: { variantId } });

describe("mouvements de stock (§20 n° 6, PostgreSQL)", () => {
  let manager: Actor;

  beforeEach(async () => {
    await resetDatabase();
    await syncRolesAndPermissions(db);
    manager = await actorWith("STOCK_MANAGER");
  });

  it("enregistre une entrée, une sortie et leur journal, avec audit", async () => {
    const variantId = await createVariant(5);
    await recordStockMovement(db, manager, { variantId, type: "IN", quantity: 10, reason: "Réception fournisseur" });
    await recordStockMovement(db, manager, { variantId, type: "OUT", quantity: 3, reason: "Casse" });

    expect(await stock(variantId)).toMatchObject({ onHand: 12, reserved: 0 });
    const movements = await db.stockMovement.findMany({ where: { variantId }, orderBy: { createdAt: "asc" } });
    expect(movements.map((m) => [m.type, m.quantity, m.onHandAfter, m.actorId])).toEqual([
      ["IN", 10, 15, manager.id],
      ["OUT", -3, 12, manager.id],
    ]);
    expect(await db.auditLog.count({ where: { action: "stock.movement", actorId: manager.id } })).toBe(2);
  });

  it("corrige le stock d'après un inventaire physique, avec motif", async () => {
    const variantId = await createVariant(8);
    await recordStockMovement(db, manager, { variantId, type: "ADJUSTMENT", countedQuantity: 6, reason: "Inventaire mensuel" });
    const inventory = await stock(variantId);
    expect(inventory).toMatchObject({ onHand: 6, lastCountedQty: 6 });
    expect(inventory.lastCountedAt).not.toBeNull();
    const [movement] = await db.stockMovement.findMany({ where: { variantId } });
    expect(movement).toMatchObject({ type: "ADJUSTMENT", quantity: -2, onHandAfter: 6, reason: "Inventaire mensuel" });
  });

  it("n'écrit aucun mouvement quand l'inventaire confirme le stock", async () => {
    const variantId = await createVariant(4);
    await recordStockMovement(db, manager, { variantId, type: "ADJUSTMENT", countedQuantity: 4, reason: "Inventaire" });
    expect(await db.stockMovement.count()).toBe(0);
    expect((await stock(variantId)).lastCountedQty).toBe(4);
  });

  it("exige un motif et une quantité valide", async () => {
    const variantId = await createVariant(4);
    await expect(recordStockMovement(db, manager, { variantId, type: "IN", quantity: 2, reason: " " })).rejects.toMatchObject({
      code: "VALIDATION",
    });
    await expect(recordStockMovement(db, manager, { variantId, type: "OUT", quantity: 0, reason: "Test" })).rejects.toMatchObject({
      code: "VALIDATION",
    });
    await expect(
      recordStockMovement(db, manager, { variantId, type: "IN", quantity: 1.5, reason: "Test" }),
    ).rejects.toMatchObject({ code: "VALIDATION" });
  });

  it("refuse une sortie qui entamerait le stock réservé", async () => {
    const variantId = await createVariant(5, 3);
    await expect(recordStockMovement(db, manager, { variantId, type: "OUT", quantity: 3, reason: "Casse" })).rejects.toMatchObject({
      code: "CONFLICT",
    });
    expect(await stock(variantId)).toMatchObject({ onHand: 5, reserved: 3 });
    expect(await db.stockMovement.count()).toBe(0);
  });

  it("ne survend jamais sous sorties simultanées (verrou de ligne)", async () => {
    const variantId = await createVariant(10);
    const results = await Promise.allSettled(
      Array.from({ length: 5 }, () => recordStockMovement(db, manager, { variantId, type: "OUT", quantity: 3, reason: "Vente comptoir" })),
    );
    expect(results.filter((r) => r.status === "fulfilled")).toHaveLength(3);
    expect((await stock(variantId)).onHand).toBe(1);
    expect(await db.stockMovement.count({ where: { variantId } })).toBe(3);
  });

  it("refuse un rôle non autorisé et journalise le refus", async () => {
    const catalog = await actorWith("CATALOG_MANAGER");
    const variantId = await createVariant(5);
    await expect(recordStockMovement(db, catalog, { variantId, type: "IN", quantity: 1, reason: "Test" })).rejects.toMatchObject({
      code: "FORBIDDEN",
    });
    expect(await db.auditLog.count({ where: { action: "authz.denied", actorId: catalog.id } })).toBe(1);
  });

  it("rend le journal des mouvements immuable", async () => {
    const variantId = await createVariant(5);
    await recordStockMovement(db, manager, { variantId, type: "IN", quantity: 1, reason: "Réception" });
    const movement = await db.stockMovement.findFirstOrThrow();
    await expect(db.stockMovement.update({ where: { id: movement.id }, data: { quantity: 99 } })).rejects.toThrow();
    await expect(db.stockMovement.delete({ where: { id: movement.id } })).rejects.toThrow();
  });

  it("liste les alertes de stock (disponible ≤ seuil)", async () => {
    const low = await createVariant(3, 1);
    await createVariant(50);
    await setAlertThreshold(db, manager, { variantId: low, alertThreshold: 2 });
    const alerts = await listStockAlerts(db, manager);
    expect(alerts.map((alert) => [alert.variantId, alert.available, alert.alertThreshold])).toEqual([[low, 2, 2]]);
  });
});
