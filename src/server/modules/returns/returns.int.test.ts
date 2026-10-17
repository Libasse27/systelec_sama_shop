import { randomUUID } from "node:crypto";
import { beforeEach, describe, expect, it } from "vitest";
import type { Actor } from "@/server/authz/service";
import { syncRolesAndPermissions } from "@/server/authz/sync";
import { db } from "@/server/db/client";
import { getPaymentJournal, getReceipt, listOrderPayments } from "@/server/modules/payments/queries";
import { renderReceiptPdf } from "@/server/modules/payments/receipt-pdf";
import { changeOrderStatus } from "@/server/modules/orders/status";
import { voidPayment } from "@/server/modules/payments/service";
import { resetDatabase } from "../../../../tests/setup/db";
import { actorWith } from "../../../../tests/support/actors";
import { closedPickupOrder, confirmedOrder, payInFull, PRICES, seedOrderCatalog, stockOf, type OrderFixtures, type PlacedOrder } from "../../../../tests/support/orders";
import { getOrderReturns, listReturns } from "./queries";
import { createReturn, decideReturn, refundReturn } from "./service";

let fixtures: OrderFixtures;
let manager: Actor;
let cashier: Actor;

const itemOf = async (orderId: string, sku: string) => (await db.orderItem.findFirstOrThrow({ where: { orderId, sku }, select: { id: true } })).id;

async function recordReturn(order: PlacedOrder, quantities: Partial<Record<keyof typeof PRICES, number>>, idempotencyKey: string = randomUUID()) {
  const items = await Promise.all(Object.entries(quantities).map(async ([sku, quantity]) => ({ orderItemId: await itemOf(order.id, sku), quantity })));
  return createReturn(db, manager, order.id, { idempotencyKey, reason: "Ne correspond pas au besoin", items });
}

const accept = (returnId: string, refundAmount: number, restock = true) =>
  decideReturn(db, manager, returnId, { decision: "ACCEPT", restock, refundAmount, note: restock ? "Articles intacts, remis en vente" : "Emballage abîmé, non remis en vente" });

const refund = (returnId: string, idempotencyKey: string = randomUUID()) => refundReturn(db, cashier, returnId, { idempotencyKey });

const orderState = (id: string) =>
  db.order.findUniqueOrThrow({ where: { id }, select: { amountPaid: true, refundedAmount: true, paymentStatus: true, status: true } });

describe("retours et remboursements (PostgreSQL)", () => {
  beforeEach(async () => {
    await resetDatabase();
    await syncRolesAndPermissions(db);
    fixtures = await seedOrderCatalog();
    manager = await actorWith("ORDER_MANAGER");
    cashier = await actorWith("FINANCE_MANAGER");
  });

  it("parcours complet : retour à vérifier, accepté avec remise en stock, remboursé en espèces avec reçu", async () => {
    const order = await closedPickupOrder(fixtures, manager, cashier, { "RT-01": 2, "SW-02": 1 });
    expect(await stockOf("RT-01")).toEqual({ onHand: 18, reserved: 0 });

    const created = await recordReturn(order, { "RT-01": 1 });
    expect(created.number).toMatch(/^RET-\d{4}-000001$/);
    expect(await orderState(order.id)).toMatchObject({ paymentStatus: "TO_VERIFY", status: "CLOSED" });

    await accept(created.id, PRICES["RT-01"]);
    expect(await stockOf("RT-01")).toEqual({ onHand: 19, reserved: 0 });
    const movement = await db.stockMovement.findFirstOrThrow({ where: { type: "RETURN" } });
    expect(movement).toMatchObject({ quantity: 1, onHandAfter: 19, reason: `Retour ${created.number}`, orderId: order.id, actorId: manager.id });
    expect(await orderState(order.id)).toMatchObject({ paymentStatus: "REFUND_PENDING" });

    const { receiptNumber } = await refund(created.id);
    expect(await orderState(order.id)).toMatchObject({ amountPaid: order.total - 25_000, refundedAmount: 25_000, paymentStatus: "REFUNDED" });
    const payment = await db.payment.findUniqueOrThrow({ where: { receiptNumber } });
    expect(payment).toMatchObject({ amount: -25_000, returnId: created.id, reversesPaymentId: null, recordedById: cashier.id, balanceAfter: 0 });
    expect((await db.return.findUniqueOrThrow({ where: { id: created.id } })).status).toBe("COMPLETED");

    // Historique, audit, notification, reçu PDF.
    const history = await db.orderStatusHistory.findMany({ where: { orderId: order.id, field: "PAYMENT" }, orderBy: { createdAt: "asc" } });
    expect(history.map((entry) => entry.to)).toEqual(["PAID", "TO_VERIFY", "REFUND_PENDING", "REFUNDED"]);
    expect(await db.auditLog.count({ where: { action: { in: ["return.create", "return.decide", "payment.refund"] } } })).toBe(3);
    expect(await db.notification.count({ where: { orderId: order.id, template: "order.refund" } })).toBe(2);
    const receipt = await getReceipt(db, { user: cashier }, receiptNumber);
    expect(receipt).toMatchObject({ amount: -25_000, refund: { returnNumber: created.number }, reversal: null });
    expect((await renderReceiptPdf(receipt!)).subarray(0, 5).toString()).toBe("%PDF-");

    // Journal de caisse : le remboursement n'est pas une annulation.
    const today = { from: new Date(Date.now() - 3_600_000), to: new Date(Date.now() + 3_600_000) };
    expect((await getPaymentJournal(db, cashier, today)).totals).toMatchObject({ received: order.total, voided: 0, refunded: 25_000, net: order.total - 25_000 });
    expect((await listOrderPayments(db, cashier, order.id)).find((row) => row.receiptNumber === receiptNumber)).toMatchObject({ refundOf: created.number });

    const view = await getOrderReturns(db, manager, order.id);
    expect(view.returns[0]).toMatchObject({ status: "COMPLETED", refundReceipt: receiptNumber, createdBy: "ORDER_MANAGER", decidedBy: "ORDER_MANAGER" });
    expect(view.returnable.find((line) => line.sku === "RT-01")).toMatchObject({ delivered: 2, remaining: 1 });
  });

  it("retour sans remise en stock (motivé) et sans remboursement : traité directement", async () => {
    const order = await closedPickupOrder(fixtures, manager, cashier);
    const created = await recordReturn(order, { "RT-01": 1 });
    await expect(decideReturn(db, manager, created.id, { decision: "ACCEPT", restock: false, refundAmount: 0, note: "" })).rejects.toMatchObject({ code: "VALIDATION" });
    expect((await accept(created.id, 0, false)).status).toBe("COMPLETED");
    expect(await stockOf("RT-01")).toEqual({ onHand: 18, reserved: 0 });
    expect(await orderState(order.id)).toMatchObject({ paymentStatus: "PAID", amountPaid: order.total });
  });

  it("retour refusé : quantités libérées pour un nouveau retour, aucun remboursement possible", async () => {
    const order = await closedPickupOrder(fixtures, manager, cashier);
    const first = await recordReturn(order, { "RT-01": 2 });
    await decideReturn(db, manager, first.id, { decision: "REJECT", note: "Hors délai de retour" });
    expect(await orderState(order.id)).toMatchObject({ paymentStatus: "PAID" });
    await expect(refund(first.id)).rejects.toThrow(/n'attend aucun remboursement/);
    await expect(accept(first.id, 0)).rejects.toThrow(/déjà été traité/);
    await recordReturn(order, { "RT-01": 2 });
  });

  it("refuse : commande non remise, quantité supérieure à la quantité livrée (retours cumulés), article d'une autre commande", async () => {
    const open = await confirmedOrder(fixtures, manager);
    await expect(recordReturn(open, { "RT-01": 1 })).rejects.toThrow(/remise au client/);

    const order = await closedPickupOrder(fixtures, manager, cashier);
    await expect(recordReturn(order, { "RT-01": 3 })).rejects.toThrow(/2 article\(s\) au plus/);
    await recordReturn(order, { "RT-01": 1 });
    await expect(recordReturn(order, { "RT-01": 2 })).rejects.toThrow(/1 article\(s\) au plus/);

    const other = await closedPickupOrder(fixtures, manager, cashier);
    const foreignItem = await itemOf(other.id, "RT-01");
    await expect(createReturn(db, manager, order.id, { idempotencyKey: randomUUID(), reason: "Test", items: [{ orderItemId: foreignItem, quantity: 1 }] })).rejects.toThrow(
      /Article inconnu/,
    );
    await expect(createReturn(db, manager, order.id, { idempotencyKey: randomUUID(), reason: "Test", items: [{ orderItemId: foreignItem, quantity: 0 }] })).rejects.toMatchObject({
      code: "VALIDATION",
    });
  });

  it("remboursement plafonné : valeur des articles, puis espèces encore détenues", async () => {
    const order = await closedPickupOrder(fixtures, manager, cashier, { "RT-01": 2 });
    const first = await recordReturn(order, { "RT-01": 1 });
    await expect(accept(first.id, 25_001)).rejects.toThrow(/valeur des articles/);
    await accept(first.id, 25_000);
    const second = await recordReturn(order, { "RT-01": 1 });
    // 50 000 encaissés, 25 000 déjà promis : 25 000 au plus.
    await accept(second.id, 25_000);
    await refund(first.id);
    await refund(second.id);
    expect(await orderState(order.id)).toMatchObject({ amountPaid: 0, refundedAmount: 50_000, paymentStatus: "REFUNDED" });
  });

  it("commande remisée : le remboursement est plafonné à la valeur des articles, remise déduite au prorata", async () => {
    const order = await confirmedOrder(fixtures, manager, { lines: { "RT-01": 2 } });
    // Remise de 10 000 sur 50 000 (le moteur de promotions n'existe pas encore : saisie directe).
    await db.order.update({ where: { id: order.id }, data: { discountTotal: 10_000, total: 40_000 } });
    const discounted = { ...order, total: 40_000 };
    await payInFull(cashier, discounted);
    await changeOrderStatus(db, manager, order.id, { status: "PREPARING" });
    await changeOrderStatus(db, manager, order.id, { status: "READY_FOR_PICKUP" });
    await changeOrderStatus(db, manager, order.id, { status: "CLOSED" });
    const created = await recordReturn(discounted, { "RT-01": 1 });
    expect((await getOrderReturns(db, manager, order.id)).returns[0]?.maxRefund).toBe(20_000);
    await expect(accept(created.id, 25_000)).rejects.toThrow(/remise déduite/);
    expect((await accept(created.id, 20_000)).status).toBe("REFUND_PENDING");
  });

  it("idempotence : double envoi du retour ou du remboursement, même simultané", async () => {
    const order = await closedPickupOrder(fixtures, manager, cashier);
    const key = randomUUID();
    const returns = await Promise.all([recordReturn(order, { "RT-01": 1 }, key), recordReturn(order, { "RT-01": 1 }, key)]);
    expect(new Set(returns.map((entry) => entry.id)).size).toBe(1);
    expect(await db.return.count()).toBe(1);

    await accept(returns[0].id, 25_000);
    const refundKey = randomUUID();
    const refunds = await Promise.all([refund(returns[0].id, refundKey), refund(returns[0].id, refundKey)]);
    expect(new Set(refunds.map((entry) => entry.receiptNumber)).size).toBe(1);
    expect(refunds.filter((entry) => entry.replayed)).toHaveLength(1);
    // Une autre clé : déjà remboursé.
    await expect(refund(returns[0].id)).rejects.toMatchObject({ code: "CONFLICT" });
    expect(await db.payment.count({ where: { returnId: { not: null } } })).toBe(1);
  });

  it("concurrence : deux retours simultanés sur la dernière unité, un seul passe", async () => {
    const order = await closedPickupOrder(fixtures, manager, cashier, { "RT-01": 1 });
    const results = await Promise.allSettled([recordReturn(order, { "RT-01": 1 }), recordReturn(order, { "RT-01": 1 })]);
    expect(results.filter((result) => result.status === "fulfilled")).toHaveLength(1);
    expect(await db.returnItem.count()).toBe(1);
  });

  it("droits : retours par orders.update, remboursement par payments.correct ; refus journalisés", async () => {
    const order = await closedPickupOrder(fixtures, manager, cashier);
    const service = await actorWith("CUSTOMER_SERVICE");
    const item = await itemOf(order.id, "RT-01");
    await expect(createReturn(db, service, order.id, { idempotencyKey: randomUUID(), reason: "Test", items: [{ orderItemId: item, quantity: 1 }] })).rejects.toMatchObject({
      code: "FORBIDDEN",
    });
    const created = await recordReturn(order, { "RT-01": 1 });
    await accept(created.id, 25_000);
    await expect(refundReturn(db, manager, created.id, { idempotencyKey: randomUUID() })).rejects.toMatchObject({ code: "FORBIDDEN" });
    await expect(refundReturn(db, await actorWith("DELIVERY_MANAGER"), created.id, { idempotencyKey: randomUUID() })).rejects.toMatchObject({ code: "FORBIDDEN" });
    expect(await db.auditLog.count({ where: { action: "authz.denied", result: "DENIED" } })).toBe(3);
    expect((await listReturns(db, service)).rows.map((row) => row.number)).toEqual([created.number]);
  });

  it("un remboursement ne s'annule pas par contre-écriture ; la commande remise renvoie vers le retour", async () => {
    const order = await closedPickupOrder(fixtures, manager, cashier);
    const original = await db.payment.findFirstOrThrow({ where: { orderId: order.id } });
    await expect(voidPayment(db, cashier, original.id, { reason: "Erreur" })).rejects.toThrow(/enregistrez un retour/);
    const created = await recordReturn(order, { "RT-01": 1 });
    await accept(created.id, 10_000);
    const { receiptNumber } = await refund(created.id);
    const refundPayment = await db.payment.findUniqueOrThrow({ where: { receiptNumber } });
    await expect(voidPayment(db, cashier, refundPayment.id, { reason: "Erreur" })).rejects.toMatchObject({ code: "CONFLICT" });
  });

  describe("intégrité en base", () => {
    it("quantité retournée ≤ quantité livrée, prix figé, commande remise, lignes en ajout seul", async () => {
      const order = await closedPickupOrder(fixtures, manager, cashier, { "RT-01": 2 });
      const item = await itemOf(order.id, "RT-01");
      const base = { number: "RET-TEST-1", orderId: order.id, reason: "Test", createdById: manager.id };
      await expect(
        db.return.create({ data: { ...base, idempotencyKey: randomUUID(), itemsValue: 75_000, items: { create: { orderItemId: item, quantity: 3, unitPrice: 25_000 } } } }),
      ).rejects.toThrow(/supérieure à la quantité livrée/);
      await expect(
        db.return.create({ data: { ...base, idempotencyKey: randomUUID(), itemsValue: 1, items: { create: { orderItemId: item, quantity: 1, unitPrice: 1 } } } }),
      ).rejects.toThrow(/prix différent/);
      // Valeur incohérente avec les lignes : refusée à la validation.
      await expect(
        db.return.create({ data: { ...base, idempotencyKey: randomUUID(), itemsValue: 1, items: { create: { orderItemId: item, quantity: 1, unitPrice: 25_000 } } } }),
      ).rejects.toThrow(/différente de ses lignes/);
      const open = await confirmedOrder(fixtures, manager);
      await expect(db.return.create({ data: { ...base, orderId: open.id, idempotencyKey: randomUUID(), itemsValue: 0 } })).rejects.toThrow(/pas été remise/);

      const created = await recordReturn(order, { "RT-01": 1 });
      await expect(db.returnItem.updateMany({ where: { returnId: created.id }, data: { quantity: 2 } })).rejects.toThrow(/ajout seul/);
      await expect(db.return.update({ where: { id: created.id }, data: { itemsValue: 1 } })).rejects.toThrow(/contenu ne se modifie pas/);
      await expect(db.return.delete({ where: { id: created.id } })).rejects.toThrow(/DELETE interdit/);
    });

    it("décision cohérente et définitive ; remboursement exact, une seule fois, jamais au-delà de l'encaissé", async () => {
      const order = await closedPickupOrder(fixtures, manager, cashier, { "RT-01": 2 });
      const created = await recordReturn(order, { "RT-01": 2 });
      await expect(db.return.update({ where: { id: created.id }, data: { status: "COMPLETED" } })).rejects.toThrow(/returns_decision_check/);
      await accept(created.id, 30_000);
      await expect(db.return.update({ where: { id: created.id }, data: { refundAmount: 50_000 } })).rejects.toThrow(/décision est définitive/);
      await expect(db.return.update({ where: { id: created.id }, data: { status: "COMPLETED" } })).rejects.toThrow(/returns_outcome_check|non enregistré/);
      // Contournement direct « à vérifier → traité » avec un remboursement décidé mais jamais versé : refusé.
      const other = await recordReturn(await closedPickupOrder(fixtures, manager, cashier), { "RT-01": 1 });
      await expect(
        db.return.update({
          where: { id: other.id },
          data: { status: "COMPLETED", refundAmount: 25_000, refundedAt: new Date(), restocked: false, decidedAt: new Date(), decidedById: manager.id, decisionNote: "Fraude" },
        }),
      ).rejects.toThrow(/remboursement non enregistré/);

      const payment = { receiptNumber: "REC-TEST-1", orderId: order.id, recordedById: cashier.id, balanceAfter: 0, returnId: created.id, reason: "Test" };
      await expect(db.payment.create({ data: { ...payment, amount: -10_000 } })).rejects.toThrow(/incohérent avec le retour/);
      await expect(db.payment.create({ data: { ...payment, amount: 30_000 } })).rejects.toThrow(/incohérent avec le retour/);
      // Écriture négative sans retour ni contre-écriture : refusée.
      await expect(db.payment.create({ data: { ...payment, returnId: null, amount: -1 } })).rejects.toThrow(/payments_amount_check/);
      // amountPaid non mis à jour : incohérence refusée à la validation.
      await expect(db.payment.create({ data: { ...payment, amount: -30_000 } })).rejects.toThrow(/différents des écritures/);
      // Remboursé > encaissé : contrainte de la commande.
      await expect(db.order.update({ where: { id: order.id }, data: { refundedAmount: order.total + 1 } })).rejects.toThrow(/orders_refunded_check/);
    });
  });
});
