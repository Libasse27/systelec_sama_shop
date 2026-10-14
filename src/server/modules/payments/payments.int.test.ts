import { randomUUID } from "node:crypto";
import { beforeEach, describe, expect, it } from "vitest";
import type { Actor } from "@/server/authz/service";
import { syncRolesAndPermissions } from "@/server/authz/sync";
import { db } from "@/server/db/client";
import { addToCart, hashCartToken } from "@/server/modules/cart/service";
import { orderAccessToken } from "@/server/modules/orders/access-token";
import { placeOrder } from "@/server/modules/orders/checkout";
import { getCustomerOrder } from "@/server/modules/orders/queries";
import { changeOrderStatus } from "@/server/modules/orders/status";
import { updateSetting } from "@/server/modules/settings/service";
import { settingsDefaults } from "@/server/modules/settings/schemas";
import { resetDatabase } from "../../../../tests/setup/db";
import { actorWith } from "../../../../tests/support/actors";
import { getPaymentJournal, getReceipt, listOrderPayments } from "./queries";
import { renderReceiptPdf } from "./receipt-pdf";
import { recordOrderPayment, voidPayment } from "./service";

const TOTAL = 50_000; // 2 × 25 000, retrait sans frais
const contact = { name: "Awa Diop", phone: "77 123 45 67", email: "awa@example.sn" };

let pickupPointId: string;
let manager: Actor;
let cashier: Actor;

async function seed(): Promise<void> {
  const category = await db.category.create({ data: { name: "Réseaux", slug: "reseaux" } });
  await db.product.create({
    data: {
      name: "Routeur",
      slug: "routeur",
      categoryId: category.id,
      shortDescription: "Court",
      description: "Long",
      status: "PUBLISHED",
      variants: { create: { sku: "RT-01", name: "Standard", price: 25_000, isDefault: true, inventory: { create: { onHand: 20 } } } },
    },
  });
  pickupPointId = (await db.pickupPoint.create({ data: { name: "Boutique", address: "Avenue Lamine Guèye, Dakar" } })).id;
}

/** Commande de 50 000 FCFA, invitée ou d'un compte, confirmée sauf indication contraire. */
async function order(options: { userId?: string; confirm?: boolean } = {}): Promise<{ id: string; number: string }> {
  const cart = options.userId ? { userId: options.userId } : { tokenHash: hashCartToken(randomUUID()) };
  await addToCart(db, cart, { sku: "RT-01", quantity: 2 });
  const placed = await placeOrder(db, { userId: options.userId ?? null, cart }, {
    idempotencyKey: randomUUID(),
    contact,
    fulfillment: { method: "PICKUP", pickupPointId },
  });
  if (options.confirm !== false) await changeOrderStatus(db, manager, placed.id, { status: "CONFIRMED" });
  return placed;
}

const pay = (actor: Actor, orderId: string, amount: number, idempotencyKey: string = randomUUID()) =>
  recordOrderPayment(db, actor, orderId, { amount, idempotencyKey });

const orderState = (id: string) => db.order.findUniqueOrThrow({ where: { id }, select: { amountPaid: true, paymentStatus: true, status: true } });

const enablePartial = () => updateSetting("commerce", { ...settingsDefaults.commerce, partialPaymentEnabled: true }, null);

describe("encaissements en espèces (§20 n° 15, 16 et 26, PostgreSQL)", () => {
  beforeEach(async () => {
    await resetDatabase();
    await syncRolesAndPermissions(db);
    await seed();
    manager = await actorWith("ORDER_MANAGER");
    cashier = await actorWith("FINANCE_MANAGER");
  });

  describe("enregistrement", () => {
    it("encaisse le solde : reçu numéroté, commande payée, historique, audit et notification", async () => {
      const { id } = await order();
      const { receiptNumber } = await pay(cashier, id, TOTAL);

      expect(receiptNumber).toMatch(/^REC-\d{4}-000001$/);
      expect(await orderState(id)).toMatchObject({ amountPaid: TOTAL, paymentStatus: "PAID" });
      const payment = await db.payment.findUniqueOrThrow({ where: { receiptNumber } });
      expect(payment).toMatchObject({ amount: TOTAL, balanceAfter: 0, method: "CASH", recordedById: cashier.id });
      const history = await db.orderStatusHistory.findFirstOrThrow({ where: { orderId: id, field: "PAYMENT" } });
      expect(history).toMatchObject({ from: "UNPAID", to: "PAID", actorId: cashier.id });
      expect(await db.auditLog.count({ where: { action: "payment.record", entityId: payment.id } })).toBe(1);
      expect(await db.notification.count({ where: { orderId: id, template: "order.payment" } })).toBe(2);
    });

    it("refuse un montant supérieur au reste à payer, et un acompte si le partiel est désactivé (D2)", async () => {
      const { id } = await order();
      await expect(pay(cashier, id, TOTAL + 1)).rejects.toThrow(/dépasse le reste à payer/);
      await expect(pay(cashier, id, 10_000)).rejects.toThrow(/paiement partiel est désactivé/);
      await expect(pay(cashier, id, 0)).rejects.toMatchObject({ code: "VALIDATION" });
      await expect(pay(cashier, id, 12.5)).rejects.toMatchObject({ code: "VALIDATION" });
      expect(await db.payment.count()).toBe(0);
    });

    it("partiel activé : acompte puis solde, le statut suit, puis plus rien à encaisser", async () => {
      await enablePartial();
      const { id } = await order();
      await pay(cashier, id, 20_000);
      expect(await orderState(id)).toMatchObject({ amountPaid: 20_000, paymentStatus: "PARTIALLY_PAID" });
      const { receiptNumber } = await pay(cashier, id, 30_000);
      expect((await db.payment.findUniqueOrThrow({ where: { receiptNumber } })).balanceAfter).toBe(0);
      expect(await orderState(id)).toMatchObject({ amountPaid: TOTAL, paymentStatus: "PAID" });
      await expect(pay(cashier, id, 1)).rejects.toThrow(/Déjà soldé/);
    });

    it("n'encaisse ni une commande non confirmée, ni une commande annulée", async () => {
      const pending = await order({ confirm: false });
      await expect(pay(cashier, pending.id, TOTAL)).rejects.toThrow(/Confirmez la commande/);
      const cancelled = await order();
      await changeOrderStatus(db, manager, cancelled.id, { status: "CANCELLED", comment: "Client injoignable" });
      await expect(pay(cashier, cancelled.id, TOTAL)).rejects.toThrow(/annulée ne s'encaisse pas/);
    });

    it("idempotence : un double envoi du formulaire, même simultané, n'encaisse qu'une fois", async () => {
      await enablePartial();
      const { id } = await order();
      const key = randomUUID();
      const results = await Promise.all([pay(cashier, id, 10_000, key), pay(cashier, id, 10_000, key)]);
      expect(new Set(results.map((result) => result.receiptNumber)).size).toBe(1);
      expect(results.filter((result) => result.replayed)).toHaveLength(1);
      expect(await orderState(id)).toMatchObject({ amountPaid: 10_000 });
      // La même clé rejouée avec un autre montant, par un autre agent ou sur une autre commande est refusée.
      await expect(pay(cashier, id, 5_000, key)).rejects.toThrow(/déjà été envoyé/);
      await expect(pay(await actorWith("FINANCE_MANAGER"), id, 10_000, key)).rejects.toThrow(/déjà été envoyé/);
      await expect(pay(cashier, (await order()).id, 10_000, key)).rejects.toThrow(/déjà été envoyé/);
    });

    it("deux agents qui encaissent le solde en même temps : un seul encaissement", async () => {
      const { id } = await order();
      const other = await actorWith("DELIVERY_MANAGER");
      const results = await Promise.allSettled([pay(cashier, id, TOTAL), pay(other, id, TOTAL)]);
      expect(results.filter((result) => result.status === "fulfilled")).toHaveLength(1);
      expect(await db.payment.count({ where: { orderId: id } })).toBe(1);
      expect(await orderState(id)).toMatchObject({ amountPaid: TOTAL, paymentStatus: "PAID" });
    });
  });

  describe("contre-écriture", () => {
    it("annule un encaissement par une écriture opposée liée ; l'original reste intact", async () => {
      const { id } = await order();
      const original = await pay(cashier, id, TOTAL);
      const { receiptNumber } = await voidPayment(db, cashier, original.id, { reason: "Erreur de commande saisie" });

      const reversal = await db.payment.findUniqueOrThrow({ where: { receiptNumber } });
      expect(reversal).toMatchObject({ amount: -TOTAL, balanceAfter: TOTAL, reversesPaymentId: original.id, reason: "Erreur de commande saisie" });
      expect(await db.payment.findUniqueOrThrow({ where: { id: original.id } })).toMatchObject({ amount: TOTAL, balanceAfter: 0 });
      expect(await orderState(id)).toMatchObject({ amountPaid: 0, paymentStatus: "UNPAID" });
      expect(await db.auditLog.count({ where: { action: "payment.void", entityId: original.id } })).toBe(1);
      // Le solde peut ensuite être de nouveau encaissé.
      await pay(cashier, id, TOTAL);
      expect(await orderState(id)).toMatchObject({ amountPaid: TOTAL, paymentStatus: "PAID" });
    });

    it("n'annule qu'une fois (même en parallèle), jamais une contre-écriture, et exige un motif", async () => {
      const { id } = await order();
      const original = await pay(cashier, id, TOTAL);
      await expect(voidPayment(db, cashier, original.id, { reason: "" })).rejects.toMatchObject({ code: "VALIDATION" });
      const results = await Promise.allSettled([
        voidPayment(db, cashier, original.id, { reason: "Doublon" }),
        voidPayment(db, cashier, original.id, { reason: "Doublon" }),
      ]);
      expect(results.filter((result) => result.status === "fulfilled")).toHaveLength(1);
      expect(await orderState(id)).toMatchObject({ amountPaid: 0 });
      const reversal = await db.payment.findFirstOrThrow({ where: { reversesPaymentId: original.id } });
      await expect(voidPayment(db, cashier, reversal.id, { reason: "Retour arrière" })).rejects.toThrow(/contre-écriture ne s'annule pas/);
      await expect(voidPayment(db, cashier, "inconnu", { reason: "Motif" })).rejects.toMatchObject({ code: "NOT_FOUND" });
    });

    it("une commande remise au client ne s'encaisse plus et ses encaissements ne s'annulent plus", async () => {
      const { id } = await order();
      const payment = await pay(cashier, id, TOTAL);
      for (const status of ["PREPARING", "READY_FOR_PICKUP", "CLOSED"]) await changeOrderStatus(db, manager, id, { status });
      await expect(voidPayment(db, cashier, payment.id, { reason: "Erreur" })).rejects.toThrow(/déjà remise au client/);
      await expect(pay(cashier, id, 1)).rejects.toThrow(/déjà remise au client/);
      expect(await orderState(id)).toMatchObject({ status: "CLOSED", amountPaid: TOTAL, paymentStatus: "PAID" });
    });

    it("une commande encaissée ne s'annule qu'après contre-écriture de ses encaissements", async () => {
      const { id } = await order();
      const payment = await pay(cashier, id, TOTAL);
      await expect(changeOrderStatus(db, manager, id, { status: "CANCELLED", comment: "Client absent" })).rejects.toThrow(/contre-écriture/);
      await voidPayment(db, cashier, payment.id, { reason: "Espèces rendues au client" });
      await changeOrderStatus(db, manager, id, { status: "CANCELLED", comment: "Client absent" });
      expect(await orderState(id)).toMatchObject({ status: "CANCELLED", amountPaid: 0 });
    });
  });

  describe("intégrité en base", () => {
    it("journal en ajout seul, contre-écriture cohérente, jamais au-delà du total", async () => {
      const { id } = await order();
      const { id: paymentId } = await pay(cashier, id, TOTAL);
      await expect(db.payment.update({ where: { id: paymentId }, data: { amount: 1 } })).rejects.toThrow();
      await expect(db.payment.delete({ where: { id: paymentId } })).rejects.toThrow();
      const reversal = { receiptNumber: "REC-TEST-1", orderId: id, balanceAfter: 0, recordedById: cashier.id, reversesPaymentId: paymentId, reason: "Test" };
      await expect(db.payment.create({ data: { ...reversal, amount: -1 } })).rejects.toThrow(/incohérente/);
      await expect(db.payment.create({ data: { ...reversal, amount: -TOTAL, reason: " " } })).rejects.toThrow();
      await expect(db.payment.create({ data: { receiptNumber: "REC-TEST-2", orderId: id, amount: -5, balanceAfter: 0, recordedById: cashier.id } })).rejects.toThrow();
      await expect(db.order.update({ where: { id }, data: { amountPaid: TOTAL + 1 } })).rejects.toThrow();
      await expect(db.order.update({ where: { id }, data: { amountPaid: -1 } })).rejects.toThrow();
    });

    it("le montant encaissé d'une commande égale toujours la somme de ses écritures (contrôle différé)", async () => {
      const { id } = await order();
      await expect(db.order.update({ where: { id }, data: { amountPaid: 10_000 } })).rejects.toThrow(/différent de la somme/);
      await expect(
        db.payment.create({ data: { receiptNumber: "REC-TEST-3", orderId: id, amount: 10_000, balanceAfter: 40_000, recordedById: cashier.id } }),
      ).rejects.toThrow(/différent de la somme/);
      expect(await orderState(id)).toMatchObject({ amountPaid: 0 });
      expect(await db.payment.count()).toBe(0);
    });

    it("une commande à 0 FCFA est soldée dès sa création", async () => {
      await db.productVariant.updateMany({ where: { sku: "RT-01" }, data: { price: 0 } });
      const { id } = await order({ confirm: false });
      expect(await orderState(id)).toMatchObject({ amountPaid: 0, paymentStatus: "PAID" });
      for (const status of ["CONFIRMED", "PREPARING", "READY_FOR_PICKUP", "CLOSED"]) await changeOrderStatus(db, manager, id, { status });
      await expect(pay(cashier, id, 1)).rejects.toMatchObject({ code: "CONFLICT" });
    });
  });

  describe("droits d'accès (§20 n° 26)", () => {
    it("encaisser exige payments.record ; annuler exige payments.correct", async () => {
      const { id } = await order();
      await expect(pay(manager, id, TOTAL)).rejects.toMatchObject({ code: "FORBIDDEN" });
      await expect(pay(await actorWith("CUSTOMER_SERVICE"), id, TOTAL)).rejects.toMatchObject({ code: "FORBIDDEN" });
      const courier = await actorWith("DELIVERY_MANAGER");
      const payment = await pay(courier, id, TOTAL);
      await expect(voidPayment(db, courier, payment.id, { reason: "Erreur" })).rejects.toMatchObject({ code: "FORBIDDEN" });
      await expect(listOrderPayments(db, await actorWith("TECHNICIAN"), id)).rejects.toMatchObject({ code: "FORBIDDEN" });
      expect(await listOrderPayments(db, courier, id)).toHaveLength(1);
      await expect(getPaymentJournal(db, courier, { from: new Date(0), to: new Date() })).rejects.toMatchObject({ code: "FORBIDDEN" });
      // Refus journalisés : deux encaissements et la consultation du technicien.
      expect(await db.auditLog.count({ where: { result: "DENIED", entityId: "payments.record" } })).toBe(3);
    });
  });

  describe("reçus et soldes", () => {
    it("reçu visible du personnel, du titulaire du compte et de l'invité muni de son lien ; 404 sinon", async () => {
      const userId = randomUUID();
      await db.user.create({ data: { id: userId, name: "Client", email: `${userId}@example.sn` } });
      const accountOrder = await order({ userId });
      const guestOrder = await order();
      const accountReceipt = (await pay(cashier, accountOrder.id, TOTAL)).receiptNumber;
      const guestReceipt = (await recordOrderPayment(db, cashier, guestOrder.id, { amount: TOTAL, idempotencyKey: randomUUID(), note: "Billets de 10 000" })).receiptNumber;
      const someone = { id: randomUUID(), roles: new Set<string>(), permissions: new Set<never>() } as unknown as Actor;
      const owner = { ...someone, id: userId } as Actor;

      expect(await getReceipt(db, { user: await actorWith("TECHNICIAN") }, guestReceipt)).toBeNull();
      expect(await getReceipt(db, { user: manager }, guestReceipt)).not.toBeNull(); // payments.read
      expect(await getReceipt(db, { user: cashier }, guestReceipt)).toMatchObject({ amount: TOTAL, balanceAfter: 0, document: { label: "Commande", number: guestOrder.number } });
      expect(await getReceipt(db, { user: owner }, accountReceipt)).not.toBeNull();
      expect(await getReceipt(db, { user: someone }, accountReceipt)).toBeNull();
      expect(await getReceipt(db, { user: null, token: orderAccessToken(accountOrder.id) }, accountReceipt)).toBeNull();
      expect(await getReceipt(db, { user: null, token: orderAccessToken(guestOrder.id) }, guestReceipt)).not.toBeNull();
      expect(await getReceipt(db, { user: null, token: orderAccessToken(accountOrder.id) }, guestReceipt)).toBeNull();
      expect(await getReceipt(db, { user: null }, guestReceipt)).toBeNull();
      // La note interne n'apparaît jamais dans le reçu.
      expect(JSON.stringify(await getReceipt(db, { user: cashier }, guestReceipt))).not.toContain("Billets");
    });

    it("le reçu d'annulation cite le reçu annulé et son motif ; le reçu d'origine mentionne l'annulation", async () => {
      const { id } = await order();
      const original = await pay(cashier, id, TOTAL);
      const { receiptNumber } = await voidPayment(db, cashier, original.id, { reason: "Doublon de saisie" });
      expect(await getReceipt(db, { user: cashier }, receiptNumber)).toMatchObject({
        amount: -TOTAL,
        reversal: { receiptNumber: original.receiptNumber, reason: "Doublon de saisie" },
      });
      expect(await getReceipt(db, { user: cashier }, original.receiptNumber)).toMatchObject({ voidedBy: receiptNumber });
    });

    it("produit un PDF du reçu", async () => {
      const { id } = await order();
      const { receiptNumber } = await pay(cashier, id, TOTAL);
      const receipt = await getReceipt(db, { user: cashier }, receiptNumber);
      // Caractères hors de la police intégrée (émoji, lettres rares) : pas d'échec du rendu.
      const pdf = await renderReceiptPdf({ ...receipt!, customer: { name: "Awa Ŵ 🙂 Ñdiaye — « test »", phone: "77 000 00 00" } });
      expect(pdf.subarray(0, 5).toString()).toBe("%PDF-");
      expect(pdf.length).toBeGreaterThan(1_000);
    });

    it("le client voit ses reçus et son reste à payer, sans les notes internes", async () => {
      await enablePartial();
      const userId = randomUUID();
      await db.user.create({ data: { id: userId, name: "Client", email: `${userId}@example.sn` } });
      const { id, number } = await order({ userId });
      await recordOrderPayment(db, cashier, id, { amount: 20_000, idempotencyKey: randomUUID(), note: "Remis au livreur" });
      const view = await getCustomerOrder(db, userId, number);
      expect(view).toMatchObject({ amountPaid: 20_000, paymentStatus: "PARTIALLY_PAID" });
      expect(view!.payments).toEqual([{ receiptNumber: expect.stringMatching(/^REC-/), amount: 20_000, createdAt: expect.any(Date) }]);
      expect(JSON.stringify(view)).not.toContain("Remis au livreur");
    });

    it("journal de caisse : totaux encaissés, annulés, net, et net par agent", async () => {
      await enablePartial();
      const courier = await actorWith("DELIVERY_MANAGER");
      const first = await order();
      const second = await order();
      const voided = await pay(cashier, first.id, 20_000);
      await pay(cashier, first.id, 30_000);
      await pay(courier, second.id, 15_000);
      await voidPayment(db, cashier, voided.id, { reason: "Erreur de montant" });

      const journal = await getPaymentJournal(db, cashier, { from: new Date(Date.now() - 3600_000), to: new Date(Date.now() + 3600_000) });
      expect(journal.totals).toEqual({ received: 65_000, voided: 20_000, net: 45_000, count: 4 });
      expect(journal.rows).toHaveLength(4);
      expect(journal.truncated).toBe(false);
      expect(journal.byRecorder).toEqual([
        { name: "DELIVERY_MANAGER", net: 15_000, count: 1 },
        { name: "FINANCE_MANAGER", net: 30_000, count: 3 },
      ]);
    });
  });
});
