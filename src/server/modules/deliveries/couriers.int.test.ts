import { randomUUID } from "node:crypto";
import { beforeEach, describe, expect, it } from "vitest";
import type { Actor } from "@/server/authz/service";
import { syncRolesAndPermissions } from "@/server/authz/sync";
import { db } from "@/server/db/client";
import { getPaymentJournal } from "@/server/modules/payments/queries";
import { recordOrderPayment, voidPayment } from "@/server/modules/payments/service";
import { getDashboard } from "@/server/modules/reports/dashboard";
import { resetDatabase } from "../../../../tests/setup/db";
import { actorWith } from "../../../../tests/support/actors";
import { closedPickupOrder, confirmedOrder, readyOrder, seedOrderCatalog, type OrderFixtures, type PlacedOrder } from "../../../../tests/support/orders";
import { getOrderDelivery, listCourierAccounts, listCouriers, listDeliveries, listMyDeliveries } from "./queries";
import { assignCourier, completeDelivery, failDelivery, saveCourier, startDelivery } from "./service";

let fixtures: OrderFixtures;
let manager: Actor;
let dispatcher: Actor;
let courier: Actor;
let courierId: string;

/** Commande à livrer, prête, assignée au livreur donné (non partie). */
async function assignedTo(targetCourierId: string): Promise<PlacedOrder> {
  const order = await confirmedOrder(fixtures, manager, { method: "DELIVERY" });
  await readyOrder(manager, order, "DELIVERY");
  await assignCourier(db, dispatcher, order.id, { courierId: targetCourierId });
  return order;
}

const pay = (actor: Actor, order: PlacedOrder) => recordOrderPayment(db, actor, order.id, { amount: order.total, idempotencyKey: randomUUID() });
const deniedCount = (actorId: string) => db.auditLog.count({ where: { action: "authz.denied", actorId, result: "DENIED" } });

describe("décision 5 : livreurs reliés à un compte (PostgreSQL)", () => {
  beforeEach(async () => {
    await resetDatabase();
    await syncRolesAndPermissions(db);
    fixtures = await seedOrderCatalog();
    manager = await actorWith("ORDER_MANAGER");
    dispatcher = await actorWith("DELIVERY_MANAGER");
    courier = await actorWith("COURIER");
    courierId = (await saveCourier(db, dispatcher, null, { name: "Ibrahima Ndiaye", phone: "77 000 11 22", kind: "INTERNAL", userId: courier.id })).id;
  });

  describe("fiche du livreur", () => {
    it("interne : compte obligatoire, actif, du personnel, rôle Livreur, un seul livreur par compte ; externe : sans compte", async () => {
      await expect(saveCourier(db, dispatcher, null, { name: "Sans compte", phone: "70 000 00 01", kind: "INTERNAL" })).rejects.toMatchObject({
        code: "VALIDATION",
        details: { fieldErrors: { userId: expect.any(Array) } },
      });
      const cashier = await actorWith("FINANCE_MANAGER");
      await expect(saveCourier(db, dispatcher, null, { name: "Mauvais rôle", phone: "70 000 00 02", kind: "INTERNAL", userId: cashier.id })).rejects.toThrow(/rôle « Livreur »/);
      await expect(saveCourier(db, dispatcher, null, { name: "Doublon", phone: "70 000 00 03", kind: "INTERNAL", userId: courier.id })).rejects.toThrow(/déjà relié/);
      const inactive = await actorWith("COURIER");
      await db.user.update({ where: { id: inactive.id }, data: { isActive: false } });
      await expect(saveCourier(db, dispatcher, null, { name: "Inactif", phone: "70 000 00 04", kind: "INTERNAL", userId: inactive.id })).rejects.toThrow(/désactivé/);

      // Transporteur externe : un compte envoyé par erreur n'est pas relié.
      const external = await saveCourier(db, dispatcher, null, { name: "Transports Dakar Express", phone: "33 800 00 00", kind: "EXTERNAL", userId: courier.id });
      expect(await db.courier.findUniqueOrThrow({ where: { id: external.id } })).toMatchObject({ kind: "EXTERNAL", userId: null });
      expect((await listCouriers(db, dispatcher)).map((row) => [row.name, row.kind, row.userId])).toEqual([
        ["Ibrahima Ndiaye", "INTERNAL", courier.id],
        ["Transports Dakar Express", "EXTERNAL", null],
      ]);
      expect((await listCourierAccounts(db, dispatcher)).map((account) => account.id).sort()).toEqual([courier.id].sort());
    });

    it("en base : un livreur interne a un compte, un externe n'en a pas", async () => {
      await expect(db.courier.create({ data: { name: "X", phone: "1", kind: "INTERNAL" } })).rejects.toThrow(/couriers_account_check/);
      await expect(db.courier.create({ data: { name: "Y", phone: "1", kind: "EXTERNAL", userId: manager.id } })).rejects.toThrow(/couriers_account_check/);
    });
  });

  it("le livreur voit ses livraisons seulement, part, encaisse le solde, livre : tout est tracé à son nom", async () => {
    const mine = await assignedTo(courierId);
    const otherCourier = await actorWith("COURIER");
    const otherId = (await saveCourier(db, dispatcher, null, { name: "Moussa Fall", phone: "77 000 33 44", kind: "INTERNAL", userId: otherCourier.id })).id;
    const theirs = await assignedTo(otherId);

    expect((await listMyDeliveries(db, courier)).map((row) => row.orderNumber)).toEqual([mine.number]);
    expect((await listMyDeliveries(db, otherCourier)).map((row) => row.orderNumber)).toEqual([theirs.number]);
    const [row] = await listMyDeliveries(db, courier);
    expect(row).toMatchObject({ balance: mine.total, customerName: "Awa Diop", status: "ASSIGNED" });
    expect(row?.address).toContain("Médina");

    // Encaissement seulement une fois parti.
    await expect(pay(courier, mine)).rejects.toMatchObject({ code: "FORBIDDEN" });
    await startDelivery(db, courier, mine.id);
    const { receiptNumber } = await pay(courier, mine);
    expect((await db.payment.findUniqueOrThrow({ where: { receiptNumber } })).recordedById).toBe(courier.id);
    await completeDelivery(db, courier, mine.id, { recipientName: "Awa Diop", proofNote: "Remis en main propre" });

    expect((await db.order.findUniqueOrThrow({ where: { id: mine.id } })).status).toBe("CLOSED");
    const steps = await db.orderStatusHistory.findMany({ where: { orderId: mine.id, field: "DELIVERY" }, orderBy: { createdAt: "asc" } });
    expect(steps.map((step) => [step.to, step.actorId === courier.id])).toEqual([
      ["ASSIGNED", false],
      ["IN_TRANSIT", true],
      ["DELIVERED", true],
    ]);
    expect(await db.auditLog.count({ where: { actorId: courier.id, action: { in: ["delivery.in_transit", "delivery.delivered", "payment.record"] } } })).toBe(3);
  });

  it("incident signalé par le livreur sur sa livraison", async () => {
    const order = await assignedTo(courierId);
    await startDelivery(db, courier, order.id);
    await failDelivery(db, courier, order.id, { reason: "Client absent, téléphone éteint" });
    expect(await db.delivery.findUniqueOrThrow({ where: { orderId: order.id } })).toMatchObject({ status: "FAILED", failureReason: "Client absent, téléphone éteint" });
  });

  describe("moindre privilège", () => {
    it("livraison d'un autre livreur : ni départ, ni encaissement, ni résultat (refus journalisés)", async () => {
      const otherCourier = await actorWith("COURIER");
      const otherId = (await saveCourier(db, dispatcher, null, { name: "Moussa Fall", phone: "77 000 33 44", kind: "INTERNAL", userId: otherCourier.id })).id;
      const theirs = await assignedTo(otherId);
      await expect(startDelivery(db, courier, theirs.id)).rejects.toMatchObject({ code: "FORBIDDEN" });
      await startDelivery(db, otherCourier, theirs.id);
      await expect(pay(courier, theirs)).rejects.toMatchObject({ code: "FORBIDDEN" });
      await expect(failDelivery(db, courier, theirs.id, { reason: "Tentative" })).rejects.toMatchObject({ code: "FORBIDDEN" });
      await expect(completeDelivery(db, courier, theirs.id, { recipientName: "Quelqu'un" })).rejects.toMatchObject({ code: "FORBIDDEN" });
      expect(await deniedCount(courier.id)).toBe(4);
      expect(await db.payment.count({ where: { orderId: theirs.id } })).toBe(0);
    });

    it("réassignée entre-temps : la livraison n'est plus la sienne", async () => {
      const order = await assignedTo(courierId);
      const externalId = (await saveCourier(db, dispatcher, null, { name: "Transporteur", phone: "33 800 00 00", kind: "EXTERNAL" })).id;
      await assignCourier(db, dispatcher, order.id, { courierId: externalId });
      await expect(startDelivery(db, courier, order.id)).rejects.toMatchObject({ code: "FORBIDDEN" });
      expect(await listMyDeliveries(db, courier)).toEqual([]);
    });

    it("aucun accès à l'assignation, aux autres livraisons, aux remboursements, à la caisse, aux commandes, aux rapports", async () => {
      const order = await assignedTo(courierId);
      await expect(assignCourier(db, courier, order.id, { courierId })).rejects.toMatchObject({ code: "FORBIDDEN" });
      await expect(listDeliveries(db, courier)).rejects.toMatchObject({ code: "FORBIDDEN" });
      await expect(getOrderDelivery(db, courier, order.id)).rejects.toMatchObject({ code: "FORBIDDEN" });
      await expect(getPaymentJournal(db, courier, { from: new Date(0), to: new Date() })).rejects.toMatchObject({ code: "FORBIDDEN" });
      await expect(saveCourier(db, courier, courierId, { name: "Moi", phone: "1234567", kind: "EXTERNAL" })).rejects.toMatchObject({ code: "FORBIDDEN" });
      // Commande en retrait (aucune livraison) : pas d'encaissement.
      const cashier = await actorWith("FINANCE_MANAGER");
      const pickup = await confirmedOrder(fixtures, manager);
      await expect(pay(courier, pickup)).rejects.toMatchObject({ code: "FORBIDDEN" });
      const closed = await closedPickupOrder(fixtures, manager, cashier);
      const payment = await db.payment.findFirstOrThrow({ where: { orderId: closed.id } });
      await expect(voidPayment(db, courier, payment.id, { reason: "Erreur" })).rejects.toMatchObject({ code: "FORBIDDEN" });

      const dashboard = await getDashboard(db, courier);
      expect(dashboard).toMatchObject({ orders: null, sales: null, cashToday: null, deliveries: null, returnAlerts: null, myDeliveries: 1 });
    });

    it("fiche de livreur désactivée : son compte ne part plus, n'encaisse plus", async () => {
      const order = await assignedTo(courierId);
      await startDelivery(db, courier, order.id);
      await saveCourier(db, dispatcher, courierId, { name: "Ibrahima Ndiaye", phone: "77 000 11 22", kind: "INTERNAL", userId: courier.id, isActive: false });
      await expect(pay(courier, order)).rejects.toMatchObject({ code: "FORBIDDEN" });
      await expect(failDelivery(db, courier, order.id, { reason: "Absent" })).rejects.toMatchObject({ code: "FORBIDDEN" });
    });

    it("le responsable garde la main sur toutes les livraisons, internes comme externes", async () => {
      const order = await assignedTo(courierId);
      await startDelivery(db, dispatcher, order.id);
      await pay(dispatcher, order);
      await completeDelivery(db, dispatcher, order.id, { recipientName: "Awa Diop" });
      expect((await db.order.findUniqueOrThrow({ where: { id: order.id } })).status).toBe("CLOSED");
    });
  });
});
