import { randomUUID } from "node:crypto";
import type { Actor } from "@/server/authz/service";
import { db } from "@/server/db/client";
import { addToCart, hashCartToken } from "@/server/modules/cart/service";
import { placeOrder } from "@/server/modules/orders/checkout";
import { changeOrderStatus } from "@/server/modules/orders/status";
import { recordOrderPayment } from "@/server/modules/payments/service";

export const contact = { name: "Awa Diop", phone: "77 123 45 67", email: "awa@example.sn" };
export const address = { line1: "Rue 10 x Rue 15", district: "Médina", city: "Dakar", landmark: "Près de la pharmacie" };

/** Prix des deux références du catalogue de test. */
export const PRICES = { "RT-01": 25_000, "SW-02": 40_000 } as const;
export const DELIVERY_FEE = 2_000;

export interface OrderFixtures {
  zoneId: string;
  pickupPointId: string;
}

/** Deux produits publiés (stock 20), une zone de livraison (2 000 FCFA) et un point de retrait. */
export async function seedOrderCatalog(): Promise<OrderFixtures> {
  const category = await db.category.create({ data: { name: "Réseaux", slug: "reseaux" } });
  for (const [sku, price] of Object.entries(PRICES)) {
    await db.product.create({
      data: {
        name: `Produit ${sku}`,
        slug: sku.toLowerCase(),
        categoryId: category.id,
        shortDescription: "Court",
        description: "Long",
        status: "PUBLISHED",
        variants: { create: { sku, name: "Standard", price, costPrice: price / 2, isDefault: true, inventory: { create: { onHand: 20 } } } },
      },
    });
  }
  const zoneId = (await db.deliveryZone.create({ data: { name: "Dakar Plateau", fee: DELIVERY_FEE } })).id;
  const pickupPointId = (await db.pickupPoint.create({ data: { name: "Boutique", address: "Avenue Lamine Guèye, Dakar" } })).id;
  return { zoneId, pickupPointId };
}

export interface PlacedOrder {
  id: string;
  number: string;
  total: number;
}

/** Commande invitée (ou d'un compte) des lignes données, confirmée par le gestionnaire. */
export async function confirmedOrder(
  fixtures: OrderFixtures,
  manager: Actor,
  options: { method?: "DELIVERY" | "PICKUP"; lines?: Partial<Record<keyof typeof PRICES, number>>; userId?: string } = {},
): Promise<PlacedOrder> {
  const method = options.method ?? "PICKUP";
  const lines = options.lines ?? { "RT-01": 2 };
  const cart = options.userId ? { userId: options.userId } : { tokenHash: hashCartToken(randomUUID()) };
  for (const [sku, quantity] of Object.entries(lines)) await addToCart(db, cart, { sku, quantity });
  const fulfillment = method === "DELIVERY" ? { method, deliveryZoneId: fixtures.zoneId, address } : { method, pickupPointId: fixtures.pickupPointId };
  const placed = await placeOrder(db, { userId: options.userId ?? null, cart }, { idempotencyKey: randomUUID(), contact, fulfillment });
  await changeOrderStatus(db, manager, placed.id, { status: "CONFIRMED" });
  const { total } = await db.order.findUniqueOrThrow({ where: { id: placed.id }, select: { total: true } });
  return { id: placed.id, number: placed.number, total };
}

/** Encaisse le solde complet. */
export const payInFull = async (cashier: Actor, order: PlacedOrder) => recordOrderPayment(db, cashier, order.id, { amount: order.total, idempotencyKey: randomUUID() });

/** Prépare puis met « prête » (retrait ou livraison). */
export async function readyOrder(manager: Actor, order: PlacedOrder, method: "DELIVERY" | "PICKUP" = "PICKUP"): Promise<void> {
  await changeOrderStatus(db, manager, order.id, { status: "PREPARING" });
  await changeOrderStatus(db, manager, order.id, { status: method === "PICKUP" ? "READY_FOR_PICKUP" : "READY_TO_SHIP" });
}

/** Commande en retrait payée et remise au client (stock sorti) ; d'un compte client si `userId` est donné. */
export async function closedPickupOrder(
  fixtures: OrderFixtures,
  manager: Actor,
  cashier: Actor,
  lines?: Partial<Record<keyof typeof PRICES, number>>,
  userId?: string,
): Promise<PlacedOrder> {
  const order = await confirmedOrder(fixtures, manager, { lines, userId });
  await payInFull(cashier, order);
  await readyOrder(manager, order);
  await changeOrderStatus(db, manager, order.id, { status: "CLOSED" });
  return order;
}

export const stockOf = (sku: string) => db.inventory.findFirstOrThrow({ where: { variant: { sku } }, select: { onHand: true, reserved: true } });
