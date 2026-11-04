import { randomUUID } from "node:crypto";
import { beforeEach, describe, expect, it } from "vitest";
import type { Actor } from "@/server/authz/service";
import { syncRolesAndPermissions } from "@/server/authz/sync";
import { db } from "@/server/db/client";
import { resetDatabase } from "../../../../tests/setup/db";
import { actorWith } from "../../../../tests/support/actors";
import { closedPickupOrder, seedOrderCatalog, type OrderFixtures } from "../../../../tests/support/orders";
import { createReturn, decideReturn, refundReturn } from "./service";

const REF = "WV-RMB-0001";
let fixtures: OrderFixtures;
let declarer: Actor;
let cashier: Actor;

/** Retour accepté, remboursement de 25 000 FCFA à verser. */
async function acceptedReturn(): Promise<string> {
  const order = await closedPickupOrder(fixtures, declarer, cashier);
  const item = await db.orderItem.findFirstOrThrow({ where: { orderId: order.id, sku: "RT-01" }, select: { id: true } });
  const created = await createReturn(db, declarer, order.id, { idempotencyKey: randomUUID(), reason: "Écran fissuré", items: [{ orderItemId: item.id, quantity: 1 }] });
  const decider = await actorWith("ADMIN");
  await decideReturn(db, decider, created.id, { decision: "ACCEPT", restock: true, refundAmount: 25_000, note: "Défaut confirmé" });
  return created.id;
}

describe("moyen de remboursement (PostgreSQL)", () => {
  beforeEach(async () => {
    await resetDatabase();
    await syncRolesAndPermissions(db);
    fixtures = await seedOrderCatalog();
    declarer = await actorWith("ORDER_MANAGER");
    cashier = await actorWith("FINANCE_MANAGER");
  });

  it("enregistre le moyen choisi sur la ligne de paiement du remboursement", async () => {
    const returnId = await acceptedReturn();
    await refundReturn(db, cashier, returnId, { idempotencyKey: randomUUID(), method: "WAVE", transactionReference: REF });
    const payment = await db.payment.findFirstOrThrow({ where: { returnId } });
    expect(payment).toMatchObject({ method: "WAVE", transactionReference: REF });
    const log = await db.auditLog.findFirstOrThrow({ where: { action: "payment.refund" } });
    expect(log.after).toMatchObject({ method: "WAVE", transactionReference: REF });
    expect(payment.amount).toBe(-25_000);
  });

  it("rejoue le même remboursement avec le même moyen sans créer de second reçu", async () => {
    const returnId = await acceptedReturn();
    const idempotencyKey = randomUUID();
    const first = await refundReturn(db, cashier, returnId, { idempotencyKey, method: "WAVE", transactionReference: REF });
    const second = await refundReturn(db, cashier, returnId, { idempotencyKey, method: "WAVE", transactionReference: REF });
    expect(second).toMatchObject({ receiptNumber: first.receiptNumber, replayed: true });
    expect(await db.payment.count({ where: { returnId } })).toBe(1);
  });

  it("refuse le rejeu de la même clé avec un autre moyen", async () => {
    const returnId = await acceptedReturn();
    const idempotencyKey = randomUUID();
    await refundReturn(db, cashier, returnId, { idempotencyKey, method: "WAVE", transactionReference: REF });
    await expect(refundReturn(db, cashier, returnId, { idempotencyKey, method: "CASH" })).rejects.toMatchObject({
      code: "CONFLICT",
      message: "Ce remboursement a déjà été envoyé.",
    });
    expect(await db.payment.count({ where: { returnId } })).toBe(1);
  });

  it("refuse un remboursement mobile sans référence", async () => {
    const returnId = await acceptedReturn();
    await expect(refundReturn(db, cashier, returnId, { idempotencyKey: randomUUID(), method: "WAVE" })).rejects.toMatchObject({
      code: "VALIDATION",
      details: { fieldErrors: { transactionReference: ["Indiquez la référence de la transaction"] } },
    });
    expect(await db.payment.count({ where: { returnId } })).toBe(0);
  });

  it("refuse une référence sur un remboursement en espèces", async () => {
    const returnId = await acceptedReturn();
    await expect(refundReturn(db, cashier, returnId, { idempotencyKey: randomUUID(), method: "CASH", transactionReference: REF })).rejects.toMatchObject({ code: "VALIDATION" });
  });

  it("refuse le rejeu de la même clé avec une autre référence", async () => {
    const returnId = await acceptedReturn();
    const idempotencyKey = randomUUID();
    await refundReturn(db, cashier, returnId, { idempotencyKey, method: "WAVE", transactionReference: REF });
    await expect(refundReturn(db, cashier, returnId, { idempotencyKey, method: "WAVE", transactionReference: "WV-RMB-0002" })).rejects.toMatchObject({
      code: "CONFLICT",
      message: "Ce remboursement a déjà été envoyé.",
    });
  });
});
