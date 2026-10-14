import { randomUUID } from "node:crypto";
import { beforeEach, describe, expect, it } from "vitest";
import type { Actor } from "@/server/authz/service";
import { syncRolesAndPermissions } from "@/server/authz/sync";
import { db } from "@/server/db/client";
import { addToCart, getCartView, hashCartToken, mergeGuestCart, setCartQuantity, type CartOwner } from "@/server/modules/cart/service";
import { updateSetting } from "@/server/modules/settings/service";
import { resetDatabase } from "../../../../tests/setup/db";
import { actorWith } from "../../../../tests/support/actors";
import { placeOrder } from "./checkout";
import { getCustomerOrder, getGuestOrder, listCustomerOrders } from "./queries";
import { cancelOwnOrder, changeOrderStatus, expireStaleOrders } from "./status";

const contact = { name: "Awa Diop", phone: "77 123 45 67", email: "awa@example.sn" };
const address = { line1: "Rue 10 x Rue 15", district: "Médina", city: "Dakar", landmark: "Près de la pharmacie" };

let zoneId: string;
let pickupPointId: string;

async function seedCatalog(): Promise<void> {
  const category = await db.category.create({ data: { name: "Réseaux", slug: "reseaux" } });
  for (const [sku, price, onHand] of [["RT-01", 25_000, 5], ["SW-02", 40_000, 10]] as const) {
    await db.product.create({
      data: {
        name: `Produit ${sku}`,
        slug: sku.toLowerCase(),
        categoryId: category.id,
        shortDescription: "Court",
        description: "Long",
        status: "PUBLISHED",
        variants: { create: { sku, name: "Standard", price, costPrice: price / 2, isDefault: true, inventory: { create: { onHand } } } },
      },
    });
  }
  zoneId = (await db.deliveryZone.create({ data: { name: "Dakar Plateau", fee: 2_000, freeAbove: 100_000 } })).id;
  pickupPointId = (await db.pickupPoint.create({ data: { name: "Boutique", address: "Avenue Lamine Guèye, Dakar" } })).id;
}

const guest = (): CartOwner => ({ tokenHash: hashCartToken(randomUUID()) });
const stockOf = (sku: string) => db.inventory.findFirstOrThrow({ where: { variant: { sku } } });

function checkout(overrides: Record<string, unknown> = {}) {
  return {
    idempotencyKey: randomUUID(),
    contact,
    fulfillment: { method: "DELIVERY", deliveryZoneId: zoneId, address },
    ...overrides,
  };
}

async function createCustomer(): Promise<string> {
  const id = randomUUID();
  await db.user.create({ data: { id, name: "Client", email: `${id}@example.sn` } });
  return id;
}

describe("panier et commandes (§20 n° 7 à 14, 17 et 25, PostgreSQL)", () => {
  beforeEach(async () => {
    await resetDatabase();
    await syncRolesAndPermissions(db);
    await seedCatalog();
  });

  describe("panier", () => {
    it("ajoute, plafonne au stock disponible, modifie et retire des articles", async () => {
      const owner = guest();
      await addToCart(db, owner, { sku: "rt-01", quantity: 2 });
      await addToCart(db, owner, { sku: "RT-01", quantity: 2 });
      await expect(addToCart(db, owner, { sku: "RT-01", quantity: 2 })).rejects.toMatchObject({ code: "CONFLICT" });
      const view = await getCartView(db, owner);
      expect(view).toMatchObject({ subtotal: 100_000, itemCount: 4, canCheckout: true });

      await setCartQuantity(db, owner, { variantId: view.lines[0]!.variantId, quantity: 0 });
      expect((await getCartView(db, owner)).lines).toHaveLength(0);
    });

    it("refuse un produit non publié et signale une ligne devenue indisponible", async () => {
      const owner = guest();
      await addToCart(db, owner, { sku: "SW-02", quantity: 1 });
      await db.product.update({ where: { slug: "sw-02" }, data: { status: "DRAFT" } });
      await expect(addToCart(db, owner, { sku: "SW-02", quantity: 1 })).rejects.toMatchObject({ code: "NOT_FOUND" });
      const view = await getCartView(db, owner);
      expect(view.lines[0]?.issue).toBe("UNAVAILABLE");
      expect(view.canCheckout).toBe(false);
    });

    it("fusionne le panier visiteur dans celui du compte à la connexion", async () => {
      const userId = await createCustomer();
      const token = randomUUID();
      await addToCart(db, { userId }, { sku: "RT-01", quantity: 1 });
      await addToCart(db, { tokenHash: hashCartToken(token) }, { sku: "RT-01", quantity: 2 });
      await addToCart(db, { tokenHash: hashCartToken(token) }, { sku: "SW-02", quantity: 1 });
      await mergeGuestCart(db, hashCartToken(token), userId);
      const view = await getCartView(db, { userId });
      expect(view.lines.map((line) => [line.sku, line.quantity])).toEqual([["RT-01", 3], ["SW-02", 1]]);
      expect(await db.cart.count()).toBe(1);
    });
  });

  describe("commande", () => {
    it("crée une commande invitée : total serveur, stock réservé, panier vidé, notifications tracées", async () => {
      const owner = guest();
      await addToCart(db, owner, { sku: "RT-01", quantity: 2 });
      const order = await placeOrder(db, { userId: null, cart: owner }, checkout({ expectedSubtotal: 50_000 }));

      expect(order.number).toMatch(/^CMD-\d{4}-000001$/);
      const saved = await db.order.findUniqueOrThrow({ where: { id: order.id }, include: { items: true, customer: true } });
      expect(saved).toMatchObject({ subtotal: 50_000, deliveryFee: 2_000, total: 52_000, status: "PENDING_CONFIRMATION", paymentStatus: "UNPAID" });
      expect(saved.items[0]).toMatchObject({ sku: "RT-01", unitPrice: 25_000, quantity: 2, lineTotal: 50_000, unitCost: 12_500 });
      expect(saved.customer.userId).toBeNull();
      expect(await stockOf("RT-01")).toMatchObject({ onHand: 5, reserved: 2 });
      expect(await db.stockMovement.findFirst({ where: { orderId: order.id } })).toMatchObject({ type: "RESERVE", quantity: 2, reservedAfter: 2 });
      expect((await getCartView(db, owner)).lines).toHaveLength(0);

      // Aucun fournisseur configuré : rien n'est simulé, l'absence est tracée.
      const notifications = await db.notification.findMany({ where: { orderId: order.id } });
      expect(notifications.map((n) => [n.channel, n.status])).toEqual(
        expect.arrayContaining([["EMAIL", "SKIPPED_NO_PROVIDER"], ["SMS", "SKIPPED_NO_PROVIDER"]]),
      );

      expect(await getGuestOrder(db, order.number, order.accessToken!)).toMatchObject({ total: 52_000 });
      expect(await getGuestOrder(db, order.number, "jeton-invalide")).toBeNull();
    });

    it("recalcule le total sur les prix en base et refuse un sous-total affiché périmé", async () => {
      const owner = guest();
      await addToCart(db, owner, { sku: "RT-01", quantity: 1 });
      await db.productVariant.update({ where: { sku: "RT-01" }, data: { price: 30_000 } });
      await expect(placeOrder(db, { userId: null, cart: owner }, checkout({ expectedSubtotal: 25_000 }))).rejects.toMatchObject({ code: "CONFLICT" });

      const order = await placeOrder(db, { userId: null, cart: owner }, checkout({ fulfillment: { method: "PICKUP", pickupPointId } }));
      expect(await db.order.findUniqueOrThrow({ where: { id: order.id } })).toMatchObject({ subtotal: 30_000, deliveryFee: 0, total: 30_000 });
    });

    it("offre la livraison au-delà du seuil de la zone", async () => {
      const owner = guest();
      await addToCart(db, owner, { sku: "SW-02", quantity: 3 });
      const order = await placeOrder(db, { userId: null, cart: owner }, checkout());
      expect(await db.order.findUniqueOrThrow({ where: { id: order.id } })).toMatchObject({ subtotal: 120_000, deliveryFee: 0, total: 120_000 });
    });

    it("ne crée qu'une commande pour une double soumission, même simultanée (idempotence)", async () => {
      const owner = guest();
      await addToCart(db, owner, { sku: "RT-01", quantity: 1 });
      const input = checkout();
      const [first, second] = await Promise.all([
        placeOrder(db, { userId: null, cart: owner }, input),
        placeOrder(db, { userId: null, cart: owner }, input),
      ]);
      expect(second.id).toBe(first.id);
      expect([first.replayed, second.replayed].sort()).toEqual([false, true]);
      expect(second.accessToken).toBe(first.accessToken);
      expect(await db.order.count()).toBe(1);
      expect(await stockOf("RT-01")).toMatchObject({ reserved: 1 });
    });

    it("ne crée qu'une commande pour un même panier soumis deux fois avec des clés différentes (deux onglets)", async () => {
      const owner = guest();
      await addToCart(db, owner, { sku: "SW-02", quantity: 2 });
      const results = await Promise.allSettled([
        placeOrder(db, { userId: null, cart: owner }, checkout()),
        placeOrder(db, { userId: null, cart: owner }, checkout()),
      ]);
      expect(results.map((result) => result.status).sort()).toEqual(["fulfilled", "rejected"]);
      expect(await db.order.count()).toBe(1);
      expect(await stockOf("SW-02")).toMatchObject({ reserved: 2 });
    });

    it("ne renvoie le lien de suivi d'une commande invitée qu'au navigateur qui l'a passée", async () => {
      const owner = guest();
      await addToCart(db, owner, { sku: "RT-01", quantity: 1 });
      const input = checkout();
      const order = await placeOrder(db, { userId: null, cart: owner }, input);
      expect((await placeOrder(db, { userId: null, cart: owner }, input)).accessToken).toBe(order.accessToken);
      await expect(placeOrder(db, { userId: null, cart: guest() }, input)).rejects.toMatchObject({ code: "CONFLICT" });
    });

    it("limite les commandes en attente par téléphone et le nombre de commandes par IP", async () => {
      for (let i = 0; i < 3; i += 1) {
        const owner = guest();
        await addToCart(db, owner, { sku: "SW-02", quantity: 1 });
        await placeOrder(db, { userId: null, cart: owner }, checkout());
      }
      const owner = guest();
      await addToCart(db, owner, { sku: "SW-02", quantity: 1 });
      const samePhoneOtherFormat = checkout({ contact: { ...contact, phone: "771234567" } });
      await expect(placeOrder(db, { userId: null, cart: owner }, samePhoneOtherFormat)).rejects.toMatchObject({ code: "RATE_LIMITED" });

      for (let i = 0; i < 10; i += 1) {
        await db.auditLog.create({ data: { action: "order.create", ip: "203.0.113.7" } });
      }
      const other = checkout({ contact: { ...contact, phone: "70 000 00 01" } });
      await expect(placeOrder(db, { userId: null, cart: owner, ip: "203.0.113.7" }, other)).rejects.toMatchObject({ code: "RATE_LIMITED" });
      expect((await placeOrder(db, { userId: null, cart: owner, ip: "203.0.113.8" }, other)).replayed).toBe(false);
    });

    it("ne survend jamais : deux clients simultanés pour le même stock", async () => {
      const [a, b] = [guest(), guest()];
      await addToCart(db, a, { sku: "RT-01", quantity: 3 });
      await addToCart(db, b, { sku: "RT-01", quantity: 3 });
      const results = await Promise.allSettled([
        placeOrder(db, { userId: null, cart: a }, checkout()),
        placeOrder(db, { userId: null, cart: b }, checkout()),
      ]);
      expect(results.map((result) => result.status).sort()).toEqual(["fulfilled", "rejected"]);
      expect(await stockOf("RT-01")).toMatchObject({ onHand: 5, reserved: 3 });
    });

    it("refuse la commande invitée si elle est désactivée (D1), et un panier vide", async () => {
      const owner = guest();
      await expect(placeOrder(db, { userId: null, cart: owner }, checkout())).rejects.toMatchObject({ code: "CONFLICT" });
      await updateSetting("commerce", { currency: "XOF", timezone: "Africa/Dakar", guestCheckoutEnabled: false, partialPaymentEnabled: false, stockReservationHours: 48 }, null);
      await addToCart(db, owner, { sku: "RT-01", quantity: 1 });
      await expect(placeOrder(db, { userId: null, cart: owner }, checkout())).rejects.toMatchObject({ code: "UNAUTHENTICATED" });
    });

    it("rattache la commande au compte et la cache aux autres clients", async () => {
      const userId = await createCustomer();
      await addToCart(db, { userId }, { sku: "SW-02", quantity: 1 });
      const order = await placeOrder(db, { userId, cart: { userId } }, checkout());
      expect(order.accessToken).toBeNull();
      expect((await listCustomerOrders(db, userId)).map((summary) => summary.number)).toEqual([order.number]);
      expect(await getCustomerOrder(db, userId, order.number)).toMatchObject({ total: 42_000 });
      const intruder = await createCustomer();
      expect(await getCustomerOrder(db, intruder, order.number)).toBeNull();
      expect(await getGuestOrder(db, order.number, undefined)).toBeNull();
    });
  });

  describe("suivi et statuts", () => {
    let manager: Actor;
    beforeEach(async () => {
      manager = await actorWith("ORDER_MANAGER");
    });

    async function pickupOrder(quantity = 2) {
      const owner = guest();
      await addToCart(db, owner, { sku: "RT-01", quantity });
      return placeOrder(db, { userId: null, cart: owner }, checkout({ fulfillment: { method: "PICKUP", pickupPointId } }));
    }

    it("suit la commande jusqu'à la remise : la vente sort le stock, l'historique est complet", async () => {
      const { id } = await pickupOrder();
      for (const status of ["CONFIRMED", "PREPARING", "READY_FOR_PICKUP", "CLOSED"]) await changeOrderStatus(db, manager, id, { status });
      expect(await stockOf("RT-01")).toMatchObject({ onHand: 3, reserved: 0 });
      const movements = await db.stockMovement.findMany({ where: { orderId: id }, orderBy: [{ createdAt: "asc" }, { id: "asc" }] });
      expect(movements.map((m) => [m.type, m.quantity])).toEqual([["RESERVE", 2], ["SALE", -2]]);
      const history = await db.orderStatusHistory.findMany({ where: { orderId: id }, orderBy: { createdAt: "asc" } });
      expect(history.map((entry) => entry.to)).toEqual(["PENDING_CONFIRMATION", "CONFIRMED", "PREPARING", "READY_FOR_PICKUP", "CLOSED"]);
      await expect(db.orderStatusHistory.delete({ where: { id: history[0]!.id } })).rejects.toThrow();
    });

    it("refuse une transition invalide, une annulation sans motif, et un rôle non autorisé", async () => {
      const { id } = await pickupOrder();
      await expect(changeOrderStatus(db, manager, id, { status: "CLOSED" })).rejects.toMatchObject({ code: "CONFLICT" });
      await expect(changeOrderStatus(db, manager, id, { status: "READY_TO_SHIP" })).rejects.toMatchObject({ code: "CONFLICT" });
      await expect(changeOrderStatus(db, manager, id, { status: "CANCELLED" })).rejects.toMatchObject({ code: "VALIDATION" });
      const stock = await actorWith("STOCK_MANAGER");
      await expect(changeOrderStatus(db, stock, id, { status: "CONFIRMED" })).rejects.toMatchObject({ code: "FORBIDDEN" });
    });

    it("libère le stock à l'annulation, une seule fois", async () => {
      const { id } = await pickupOrder();
      await changeOrderStatus(db, manager, id, { status: "CONFIRMED" });
      await changeOrderStatus(db, manager, id, { status: "CANCELLED", comment: "Client injoignable" });
      await expect(changeOrderStatus(db, manager, id, { status: "CONFIRMED" })).rejects.toMatchObject({ code: "CONFLICT" });
      expect(await stockOf("RT-01")).toMatchObject({ onHand: 5, reserved: 0 });
      expect(await db.notification.count({ where: { orderId: id, template: "order.status" } })).toBeGreaterThan(0);
    });

    it("laisse le client annuler une commande non confirmée, pas une commande confirmée", async () => {
      const userId = await createCustomer();
      await addToCart(db, { userId }, { sku: "RT-01", quantity: 1 });
      const first = await placeOrder(db, { userId, cart: { userId } }, checkout());
      await cancelOwnOrder(db, userId, first.number);
      expect(await stockOf("RT-01")).toMatchObject({ reserved: 0 });

      await addToCart(db, { userId }, { sku: "RT-01", quantity: 1 });
      const second = await placeOrder(db, { userId, cart: { userId } }, checkout());
      await changeOrderStatus(db, manager, second.id, { status: "CONFIRMED" });
      await expect(cancelOwnOrder(db, userId, second.number)).rejects.toMatchObject({ code: "CONFLICT" });
    });

    it("annule les commandes non confirmées après le délai de réservation (D3)", async () => {
      const stale = await pickupOrder(1);
      const confirmed = await pickupOrder(1);
      await changeOrderStatus(db, manager, confirmed.id, { status: "CONFIRMED" });
      const expired = await expireStaleOrders(db, new Date(Date.now() + 49 * 3600 * 1000));
      expect(expired).toEqual([stale.number]);
      expect(await db.order.findUniqueOrThrow({ where: { id: stale.id } })).toMatchObject({ status: "CANCELLED" });
      expect(await db.order.findUniqueOrThrow({ where: { id: confirmed.id } })).toMatchObject({ status: "CONFIRMED" });
      expect(await stockOf("RT-01")).toMatchObject({ reserved: 1 });
    });
  });
});
