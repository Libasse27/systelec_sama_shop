import { beforeEach, describe, expect, it } from "vitest";
import type { Actor } from "@/server/authz/service";
import { syncRolesAndPermissions } from "@/server/authz/sync";
import { db } from "@/server/db/client";
import { getAdminOrder } from "@/server/modules/orders/queries";
import { changeOrderStatus } from "@/server/modules/orders/status";
import { resetDatabase } from "../../../../tests/setup/db";
import { actorWith } from "../../../../tests/support/actors";
import { confirmedOrder, payInFull, readyOrder, seedOrderCatalog, stockOf, type OrderFixtures, type PlacedOrder } from "../../../../tests/support/orders";
import { getOrderDelivery, listCouriers, listDeliveries } from "./queries";
import { assignCourier, completeDelivery, failDelivery, saveCourier, startDelivery } from "./service";

let fixtures: OrderFixtures;
let manager: Actor;
let dispatcher: Actor;
let courierId: string;

const deliveryOrder = () => confirmedOrder(fixtures, manager, { method: "DELIVERY" });
const deliveryOf = (orderId: string) => db.delivery.findUniqueOrThrow({ where: { orderId } });
const orderStatus = async (id: string) => (await db.order.findUniqueOrThrow({ where: { id }, select: { status: true } })).status;

/** Commande à livrer, prête, livreur assigné et parti. */
async function inTransit(): Promise<PlacedOrder> {
  const order = await deliveryOrder();
  await readyOrder(manager, order, "DELIVERY");
  await assignCourier(db, dispatcher, order.id, { courierId });
  await startDelivery(db, dispatcher, order.id);
  return order;
}

describe("livraisons détaillées (PostgreSQL)", () => {
  beforeEach(async () => {
    await resetDatabase();
    await syncRolesAndPermissions(db);
    fixtures = await seedOrderCatalog();
    manager = await actorWith("ORDER_MANAGER");
    dispatcher = await actorWith("DELIVERY_MANAGER");
    courierId = (await saveCourier(db, dispatcher, null, { name: "Ibrahima Ndiaye", phone: "77 000 11 22", isActive: true })).id;
  });

  it("livreurs : création, modification, nom unique, audit, droits", async () => {
    await expect(saveCourier(db, dispatcher, null, { name: "Ibrahima Ndiaye", phone: "70 000 00 00" })).rejects.toMatchObject({ code: "CONFLICT" });
    await saveCourier(db, dispatcher, courierId, { name: "Ibrahima Ndiaye", phone: "77 000 11 22", isActive: false });
    expect((await listCouriers(db, dispatcher))[0]).toMatchObject({ isActive: false, activeDeliveries: 0 });
    expect(await db.auditLog.count({ where: { action: { in: ["courier.create", "courier.update"] } } })).toBe(2);
    const finance = await actorWith("FINANCE_MANAGER");
    await expect(saveCourier(db, finance, null, { name: "Autre", phone: "70 000 00 00" })).rejects.toMatchObject({ code: "FORBIDDEN" });
  });

  it("parcours complet : assignation, départ, encaissement par le livreur, livraison avec preuve, commande remise", async () => {
    const order = await deliveryOrder();
    await assignCourier(db, dispatcher, order.id, { courierId, scheduledFor: "2026-12-01", note: "Appeler avant" });
    await readyOrder(manager, order, "DELIVERY");
    await startDelivery(db, dispatcher, order.id);
    expect(await deliveryOf(order.id)).toMatchObject({ status: "IN_TRANSIT", attempts: 1 });
    expect((await listDeliveries(db, dispatcher)).rows).toMatchObject([{ orderNumber: order.number, status: "IN_TRANSIT", courierName: "Ibrahima Ndiaye" }]);

    // Non soldée : la livraison n'est pas validée, rien ne change.
    await expect(completeDelivery(db, dispatcher, order.id, { recipientName: "Awa Diop" })).rejects.toThrow(/non soldée/);
    expect(await deliveryOf(order.id)).toMatchObject({ status: "IN_TRANSIT" });

    await payInFull(dispatcher, order); // le responsable de livraison encaisse (payments.record)
    await completeDelivery(db, dispatcher, order.id, { recipientName: "Awa Diop", proofNote: "Remis en main propre" });
    expect(await deliveryOf(order.id)).toMatchObject({ status: "DELIVERED", recipientName: "Awa Diop", proofNote: "Remis en main propre" });
    // Les observations restent internes : ni dans l'historique visible du client, ni dans ses messages.
    const visible = await db.orderStatusHistory.findMany({ where: { orderId: order.id, field: "ORDER" } });
    expect(JSON.stringify(visible)).not.toContain("Remis en main propre");
    expect(JSON.stringify(await db.notification.findMany({ where: { orderId: order.id } }))).not.toContain("Remis en main propre");
    expect(await orderStatus(order.id)).toBe("CLOSED");
    expect(await stockOf("RT-01")).toEqual({ onHand: 18, reserved: 0 });

    const steps = await db.orderStatusHistory.findMany({ where: { orderId: order.id, field: "DELIVERY" }, orderBy: { createdAt: "asc" } });
    expect(steps.map((entry) => entry.to)).toEqual(["ASSIGNED", "IN_TRANSIT", "DELIVERED"]);
    expect(steps[0]?.comment).toBe("Livreur : Ibrahima Ndiaye — Appeler avant");
    expect(await db.notification.count({ where: { orderId: order.id, template: "order.status", payload: { path: ["statusLabel"], equals: "Livrée" } } })).toBe(2);
    expect((await getOrderDelivery(db, manager, order.id))?.status).toBe("DELIVERED");

    // Livrée : définitive.
    await expect(failDelivery(db, dispatcher, order.id, { reason: "Erreur" })).rejects.toMatchObject({ code: "CONFLICT" });
    await expect(db.delivery.update({ where: { orderId: order.id }, data: { status: "FAILED", failureReason: "x" } })).rejects.toThrow(/ne se modifie plus/);
  });

  it("échec motivé, puis nouvelle tentative avec un autre livreur", async () => {
    const order = await inTransit();
    await expect(failDelivery(db, dispatcher, order.id, { reason: "" })).rejects.toMatchObject({ code: "VALIDATION" });
    await failDelivery(db, dispatcher, order.id, { reason: "Client absent" });
    expect(await deliveryOf(order.id)).toMatchObject({ status: "FAILED", failureReason: "Client absent" });
    expect((await listDeliveries(db, dispatcher, { status: "FAILED" })).total).toBe(1);

    const other = (await saveCourier(db, dispatcher, null, { name: "Moussa Sarr", phone: "76 000 00 00" })).id;
    await assignCourier(db, dispatcher, order.id, { courierId: other });
    await startDelivery(db, dispatcher, order.id);
    expect(await deliveryOf(order.id)).toMatchObject({ status: "IN_TRANSIT", attempts: 2, courierId: other });
  });

  it("refuse : retrait en boutique, livreur désactivé, départ avant « prête à livrer », réassignation en route", async () => {
    const pickup = await confirmedOrder(fixtures, manager);
    await expect(assignCourier(db, dispatcher, pickup.id, { courierId })).rejects.toThrow(/retirer en boutique/);

    const order = await deliveryOrder();
    const inactive = (await saveCourier(db, dispatcher, null, { name: "Inactif", phone: "70 111 11 11", isActive: false })).id;
    await expect(assignCourier(db, dispatcher, order.id, { courierId: inactive })).rejects.toThrow(/désactivé/);
    await expect(startDelivery(db, dispatcher, order.id)).rejects.toThrow(/Assignez d'abord/);
    await assignCourier(db, dispatcher, order.id, { courierId });
    await expect(startDelivery(db, dispatcher, order.id)).rejects.toThrow(/Prête à livrer/);
    await readyOrder(manager, order, "DELIVERY");
    await startDelivery(db, dispatcher, order.id);
    await expect(assignCourier(db, dispatcher, order.id, { courierId })).rejects.toThrow(/déjà parti/);
    await expect(assignCourier(db, dispatcher, order.id, { courierId, scheduledFor: "2026-02-30" })).rejects.toMatchObject({ code: "VALIDATION" });
  });

  it("une commande en livraison ne s'annule pas et ne se clôt que par la livraison", async () => {
    const order = await inTransit();
    await expect(changeOrderStatus(db, manager, order.id, { status: "CANCELLED", comment: "Client injoignable" })).rejects.toThrow(/Livraison en cours/);
    await payInFull(dispatcher, order);
    await expect(changeOrderStatus(db, manager, order.id, { status: "CLOSED" })).rejects.toThrow(/uniquement par un livreur/);
  });

  it("décision 5 : une commande à livrer ne se remet jamais à la main, même soldée et sans livreur ; le retrait reste manuel", async () => {
    const order = await deliveryOrder();
    await readyOrder(manager, order, "DELIVERY");
    await payInFull(dispatcher, order);
    await expect(changeOrderStatus(db, manager, order.id, { status: "CLOSED" })).rejects.toThrow(/uniquement par un livreur/);
    // Livreur assigné mais pas parti : toujours pas de remise manuelle.
    await assignCourier(db, dispatcher, order.id, { courierId });
    await expect(changeOrderStatus(db, manager, order.id, { status: "CLOSED" })).rejects.toThrow(/uniquement par un livreur/);
    expect(await orderStatus(order.id)).toBe("READY_TO_SHIP");
    // Le statut « Remise au client » n'est pas proposé pour une commande à livrer.
    const view = await getAdminOrder(db, manager, order.id);
    expect(view?.nextStatuses).toEqual(["CANCELLED"]);

    // Seule la livraison effectuée la remet au client.
    await startDelivery(db, dispatcher, order.id);
    await completeDelivery(db, dispatcher, order.id, { recipientName: "Awa Diop" });
    expect(await orderStatus(order.id)).toBe("CLOSED");

    const pickup = await confirmedOrder(fixtures, manager);
    await readyOrder(manager, pickup);
    expect((await getAdminOrder(db, manager, pickup.id))?.nextStatuses).toEqual(["CLOSED", "CANCELLED"]);
  });

  it("décision 5 en base : clôture d'une commande à livrer sans livraison effectuée refusée, même par SQL direct", async () => {
    const order = await deliveryOrder();
    await readyOrder(manager, order, "DELIVERY");
    await payInFull(dispatcher, order);
    await expect(db.order.update({ where: { id: order.id }, data: { status: "CLOSED", closedAt: new Date() } })).rejects.toThrow(/que par une livraison effectuée/);
    await assignCourier(db, dispatcher, order.id, { courierId });
    await expect(db.order.update({ where: { id: order.id }, data: { status: "CLOSED", closedAt: new Date() } })).rejects.toThrow(/que par une livraison effectuée/);
    expect(await orderStatus(order.id)).toBe("READY_TO_SHIP");
  });

  it("droits : seul deliveries.manage pilote les livraisons ; refus journalisé", async () => {
    const order = await deliveryOrder();
    await expect(assignCourier(db, await actorWith("FINANCE_MANAGER"), order.id, { courierId })).rejects.toMatchObject({ code: "FORBIDDEN" });
    await expect(listDeliveries(db, await actorWith("CUSTOMER_SERVICE"))).rejects.toMatchObject({ code: "FORBIDDEN" });
    expect(await db.auditLog.count({ where: { action: "authz.denied", entityId: "deliveries.manage" } })).toBe(2);
  });

  it("en base : pas de livraison pour un retrait, preuve exigée pour « livrée », pas de suppression", async () => {
    const pickup = await confirmedOrder(fixtures, manager);
    await expect(db.delivery.create({ data: { orderId: pickup.id, courierId } })).rejects.toThrow(/retirer en boutique/);
    const order = await inTransit();
    await expect(db.delivery.update({ where: { orderId: order.id }, data: { status: "DELIVERED", deliveredAt: new Date() } })).rejects.toThrow(/deliveries_state_check/);
    await expect(db.delivery.delete({ where: { orderId: order.id } })).rejects.toThrow(/DELETE interdit/);
    // « Livrée » sans clôture de la commande : refusé à la validation de la transaction.
    await expect(
      db.delivery.update({ where: { orderId: order.id }, data: { status: "DELIVERED", deliveredAt: new Date(), recipientName: "X" } }),
    ).rejects.toThrow(/pas clôturée/);
  });

  it("deux départs simultanés : une seule tentative comptée", async () => {
    const order = await deliveryOrder();
    await readyOrder(manager, order, "DELIVERY");
    await assignCourier(db, dispatcher, order.id, { courierId });
    const results = await Promise.allSettled([startDelivery(db, dispatcher, order.id), startDelivery(db, dispatcher, order.id)]);
    expect(results.filter((result) => result.status === "fulfilled")).toHaveLength(1);
    expect(await deliveryOf(order.id)).toMatchObject({ status: "IN_TRANSIT", attempts: 1 });
  });

  it("une commande annulée avant le départ libère le stock et sort des livraisons à faire", async () => {
    const order = await deliveryOrder();
    await assignCourier(db, dispatcher, order.id, { courierId });
    expect((await listDeliveries(db, dispatcher)).total).toBe(1);
    await changeOrderStatus(db, manager, order.id, { status: "CANCELLED", comment: "Client a renoncé" });
    expect(await stockOf("RT-01")).toEqual({ onHand: 20, reserved: 0 });
    expect((await listDeliveries(db, dispatcher)).total).toBe(0);
    expect((await listCouriers(db, dispatcher))[0]?.activeDeliveries).toBe(0);
    // Toujours consultable avec un filtre explicite.
    expect((await listDeliveries(db, dispatcher, { status: "ASSIGNED" })).total).toBe(1);
  });
});
