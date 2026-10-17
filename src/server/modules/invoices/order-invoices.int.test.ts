import { randomUUID } from "node:crypto";
import { beforeEach, describe, expect, it } from "vitest";
import type { Actor } from "@/server/authz/service";
import { syncRolesAndPermissions } from "@/server/authz/sync";
import { db } from "@/server/db/client";
import { orderAccessToken } from "@/server/modules/orders/access-token";
import { createReturn, decideReturn, refundReturn } from "@/server/modules/returns/service";
import { updateSetting } from "@/server/modules/settings/service";
import { resetDatabase } from "../../../../tests/setup/db";
import { actorWith } from "../../../../tests/support/actors";
import { closedPickupOrder, confirmedOrder, DELIVERY_FEE, payInFull, seedOrderCatalog, type OrderFixtures } from "../../../../tests/support/orders";
import { renderInvoicePdf } from "./invoice-pdf";
import { getInvoice, issueOrderInvoice } from "./service";

let fixtures: OrderFixtures;
let manager: Actor;
let cashier: Actor;

describe("factures de commandes (PostgreSQL)", () => {
  beforeEach(async () => {
    await resetDatabase();
    await syncRolesAndPermissions(db);
    fixtures = await seedOrderCatalog();
    manager = await actorWith("ORDER_MANAGER");
    cashier = await actorWith("FINANCE_MANAGER");
  });

  it("facture unique et figée d'une commande soldée : articles, frais de livraison, PDF", async () => {
    const order = await confirmedOrder(fixtures, manager, { method: "DELIVERY", lines: { "RT-01": 2, "SW-02": 1 } });
    await expect(issueOrderInvoice(db, manager, order.id)).rejects.toThrow(/soldée/);
    await payInFull(cashier, order);

    const { number } = await issueOrderInvoice(db, cashier, order.id);
    expect(number).toMatch(/^FAC-\d{4}-000001$/);
    await expect(issueOrderInvoice(db, manager, order.id)).rejects.toThrow(/déjà émise/);

    const invoice = await getInvoice(db, { user: manager }, number);
    expect(invoice).toMatchObject({ document: { label: "Commande", number: order.number }, total: order.total, amountPaid: order.total, refunded: 0, vat: null });
    expect(invoice?.lines).toEqual([
      { label: "Produit RT-01 — Standard", quantity: 2, unitPrice: 25_000, lineTotal: 50_000 },
      { label: "Produit SW-02 — Standard", quantity: 1, unitPrice: 40_000, lineTotal: 40_000 },
      { label: "Frais de livraison", quantity: 1, unitPrice: DELIVERY_FEE, lineTotal: DELIVERY_FEE },
    ]);
    expect(invoice?.customer.address).toBe("Livraison : Rue 10 x Rue 15, Médina, Dakar (Près de la pharmacie)");
    expect((await renderInvoicePdf(invoice!)).subarray(0, 5).toString()).toBe("%PDF-");
    expect(await db.auditLog.count({ where: { action: "invoice.issue", result: "SUCCESS" } })).toBe(1);
    await expect(db.invoice.update({ where: { number }, data: { total: 1 } })).rejects.toThrow(/ajout seul/);
  });

  it("deux émissions simultanées : une seule facture", async () => {
    const order = await closedPickupOrder(fixtures, manager, cashier);
    const results = await Promise.allSettled([issueOrderInvoice(db, manager, order.id), issueOrderInvoice(db, manager, order.id)]);
    expect(results.filter((result) => result.status === "fulfilled")).toHaveLength(1);
    expect(await db.invoice.count()).toBe(1);
  });

  it("TVA incluse affichée si son détail est activé (D6) ; remboursement ultérieur mentionné", async () => {
    await updateSetting("tax", { vatDetailEnabled: true, vatRate: 18 }, null);
    const order = await closedPickupOrder(fixtures, manager, cashier);
    const { number } = await issueOrderInvoice(db, manager, order.id);
    const item = await db.orderItem.findFirstOrThrow({ where: { orderId: order.id } });
    const created = await createReturn(db, manager, order.id, { idempotencyKey: randomUUID(), reason: "Défaut", items: [{ orderItemId: item.id, quantity: 1 }] });
    await decideReturn(db, manager, created.id, { decision: "ACCEPT", restock: false, refundAmount: 25_000, note: "Écran fêlé" });
    await refundReturn(db, cashier, created.id, { idempotencyKey: randomUUID() });

    const invoice = await getInvoice(db, { user: manager }, number);
    expect(invoice).toMatchObject({ total: 50_000, amountPaid: 50_000, refunded: 25_000, vat: { rate: 18, amount: 7_627 } });
    expect((await renderInvoicePdf(invoice!)).subarray(0, 5).toString()).toBe("%PDF-");
  });

  it("accès : personnel autorisé, titulaire du compte, invité muni du jeton de SA commande ; sinon rien", async () => {
    const userId = randomUUID();
    await db.user.create({ data: { id: userId, name: "Client", email: `${userId}@example.sn` } });
    const owned = await confirmedOrder(fixtures, manager, { userId });
    await payInFull(cashier, owned);
    const guest = await closedPickupOrder(fixtures, manager, cashier);
    const ownedInvoice = (await issueOrderInvoice(db, manager, owned.id)).number;
    const guestInvoice = (await issueOrderInvoice(db, manager, guest.id)).number;

    const customer = { id: userId, roles: [], permissions: new Set<never>() };
    expect(await getInvoice(db, { user: customer }, ownedInvoice)).not.toBeNull();
    expect(await getInvoice(db, { user: customer }, guestInvoice)).toBeNull();
    expect(await getInvoice(db, { user: null, token: orderAccessToken(guest.id) }, guestInvoice)).not.toBeNull();
    expect(await getInvoice(db, { user: null, token: orderAccessToken(owned.id) }, guestInvoice)).toBeNull();
    // Le document d'un compte ne s'ouvre jamais avec un simple jeton.
    expect(await getInvoice(db, { user: null, token: orderAccessToken(owned.id) }, ownedInvoice)).toBeNull();
    expect(await getInvoice(db, { user: await actorWith("TECHNICIAN") }, guestInvoice)).toBeNull();
  });

  it("droits et intégrité : émission refusée sans orders.update ni payments.correct ; commande annulée refusée en base", async () => {
    const order = await closedPickupOrder(fixtures, manager, cashier);
    await expect(issueOrderInvoice(db, await actorWith("CUSTOMER_SERVICE"), order.id)).rejects.toMatchObject({ code: "FORBIDDEN" });
    const cancelled = await confirmedOrder(fixtures, manager);
    await db.order.update({ where: { id: cancelled.id }, data: { status: "CANCELLED" } });
    await expect(issueOrderInvoice(db, manager, cancelled.id)).rejects.toThrow(/annulée/);
    const base = { lines: [], customer: {}, total: 0, issuedById: manager.id };
    await expect(db.invoice.create({ data: { ...base, number: "FAC-T-1", orderId: cancelled.id } })).rejects.toThrow(/doit être soldée/);
    await expect(db.invoice.create({ data: { ...base, number: "FAC-T-2" } })).rejects.toThrow(/invoices_target_check/);
  });
});
