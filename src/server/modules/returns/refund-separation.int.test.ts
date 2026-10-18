import { randomUUID } from "node:crypto";
import { beforeEach, describe, expect, it } from "vitest";
import type { Actor } from "@/server/authz/service";
import { syncRolesAndPermissions } from "@/server/authz/sync";
import { db } from "@/server/db/client";
import { resetDatabase } from "../../../../tests/setup/db";
import { actorWith } from "../../../../tests/support/actors";
import { closedPickupOrder, seedOrderCatalog, type OrderFixtures } from "../../../../tests/support/orders";
import { createReturn, decideReturn, refundReturn } from "./service";

let fixtures: OrderFixtures;
let declarer: Actor;
let cashier: Actor;

/** Retour accepté par `decider`, remboursement de 25 000 FCFA à verser. */
async function acceptedReturn(decider: Actor): Promise<string> {
  const order = await closedPickupOrder(fixtures, declarer, cashier);
  const item = await db.orderItem.findFirstOrThrow({ where: { orderId: order.id, sku: "RT-01" }, select: { id: true } });
  const created = await createReturn(db, declarer, order.id, { idempotencyKey: randomUUID(), reason: "Écran fissuré", items: [{ orderItemId: item.id, quantity: 1 }] });
  await decideReturn(db, decider, created.id, { decision: "ACCEPT", restock: true, refundAmount: 25_000, note: "Défaut confirmé" });
  return created.id;
}

const returnRow = (id: string) => db.return.findUniqueOrThrow({ where: { id } });

describe("décision 1 : séparation entre décision et remboursement (PostgreSQL)", () => {
  beforeEach(async () => {
    await resetDatabase();
    await syncRolesAndPermissions(db);
    fixtures = await seedOrderCatalog();
    declarer = await actorWith("ORDER_MANAGER");
    cashier = await actorWith("FINANCE_MANAGER");
  });

  it("la personne qui a décidé ne verse pas le remboursement : refus journalisé ; une autre personne le verse", async () => {
    const admin = await actorWith("ADMIN");
    const returnId = await acceptedReturn(admin);

    await expect(refundReturn(db, admin, returnId, { idempotencyKey: randomUUID() })).rejects.toMatchObject({ code: "FORBIDDEN" });
    // Même avec un motif : l'administrateur n'a pas la permission d'exception.
    await expect(refundReturn(db, admin, returnId, { idempotencyKey: randomUUID(), selfApprovalNote: "Seul présent" })).rejects.toMatchObject({ code: "FORBIDDEN" });
    expect(await db.auditLog.count({ where: { action: "authz.denied", entityId: returnId, actorId: admin.id, result: "DENIED" } })).toBe(2);
    expect(await returnRow(returnId)).toMatchObject({ status: "REFUND_PENDING", refundExceptionNote: null });
    expect(await db.payment.count({ where: { returnId } })).toBe(0);

    await refundReturn(db, cashier, returnId, { idempotencyKey: randomUUID() });
    expect(await returnRow(returnId)).toMatchObject({ status: "COMPLETED", refundExceptionNote: null });
    const event = await db.returnEvent.findFirstOrThrow({ where: { returnId, type: "REFUNDED" } });
    expect(event.actorId).toBe(cashier.id);
    expect(event.details).not.toHaveProperty("selfApproval");
  });

  it("exception contrôlée : l'administrateur principal qui a décidé verse lui-même, avec un motif obligatoire, tracé", async () => {
    const owner = await actorWith("SUPER_ADMIN");
    const returnId = await acceptedReturn(owner);

    await expect(refundReturn(db, owner, returnId, { idempotencyKey: randomUUID() })).rejects.toMatchObject({
      code: "VALIDATION",
      details: { fieldErrors: { selfApprovalNote: expect.any(Array) } },
    });
    expect((await returnRow(returnId)).status).toBe("REFUND_PENDING");

    const note = "Seul administrateur présent à la boutique ce jour";
    await refundReturn(db, owner, returnId, { idempotencyKey: randomUUID(), selfApprovalNote: note });
    expect(await returnRow(returnId)).toMatchObject({ status: "COMPLETED", refundExceptionNote: note });
    const event = await db.returnEvent.findFirstOrThrow({ where: { returnId, type: "REFUNDED" } });
    expect(event.details).toMatchObject({ selfApproval: true, refundExceptionNote: note });
    expect(event.comment).toContain(note);
    const audit = await db.auditLog.findFirstOrThrow({ where: { action: "payment.refund", entityId: returnId } });
    expect(audit.after).toMatchObject({ selfApproval: true, refundExceptionNote: note });
  });

  it("un motif d'exception envoyé par une autre personne n'est pas enregistré", async () => {
    const returnId = await acceptedReturn(await actorWith("ADMIN"));
    await refundReturn(db, cashier, returnId, { idempotencyKey: randomUUID(), selfApprovalNote: "Inutile" });
    expect((await returnRow(returnId)).refundExceptionNote).toBeNull();
  });

  it("double remboursement impossible : deux versements simultanés, un seul reçu", async () => {
    const returnId = await acceptedReturn(await actorWith("ADMIN"));
    const otherCashier = await actorWith("FINANCE_MANAGER");
    const results = await Promise.allSettled([
      refundReturn(db, cashier, returnId, { idempotencyKey: randomUUID() }),
      refundReturn(db, otherCashier, returnId, { idempotencyKey: randomUUID() }),
    ]);
    expect(results.filter((result) => result.status === "fulfilled")).toHaveLength(1);
    expect(await db.payment.count({ where: { returnId } })).toBe(1);
    expect(await db.returnEvent.count({ where: { returnId, type: "REFUNDED" } })).toBe(1);
    await expect(refundReturn(db, cashier, returnId, { idempotencyKey: randomUUID() })).rejects.toMatchObject({ code: "CONFLICT" });
  });

  describe("en base", () => {
    it("versement par le décideur sans exception refusé, même par SQL direct ; exception figée ensuite", async () => {
      const admin = await actorWith("ADMIN");
      const returnId = await acceptedReturn(admin);
      const { orderId } = await returnRow(returnId);
      const bypass = (refundExceptionNote: string | null) =>
        db.$transaction(async (tx) => {
          await tx.payment.create({
            data: { receiptNumber: `R-TEST-${randomUUID()}`, orderId, amount: -25_000, balanceAfter: 0, recordedById: admin.id, idempotencyKey: randomUUID(), returnId, reason: "Contournement" },
          });
          // Montants de la commande tenus cohérents avec les écritures (contrôle différé en base).
          await tx.order.update({ where: { id: orderId }, data: { amountPaid: { decrement: 25_000 }, refundedAmount: { increment: 25_000 } } });
          await tx.return.update({ where: { id: returnId }, data: { status: "COMPLETED", refundedAt: new Date(), refundExceptionNote } });
        });
      await expect(bypass(null)).rejects.toThrow(/ne verse pas le remboursement/);
      expect((await returnRow(returnId)).status).toBe("REFUND_PENDING");

      await bypass("Exception motivée");
      await expect(db.return.update({ where: { id: returnId }, data: { refundExceptionNote: "Réécrite" } })).rejects.toThrow(/exception de remboursement ne se modifie pas/);
    });

    it("motif d'exception impossible avant le versement", async () => {
      const returnId = await acceptedReturn(await actorWith("ADMIN"));
      await expect(db.return.update({ where: { id: returnId }, data: { refundExceptionNote: "Avant versement" } })).rejects.toThrow(/exception de remboursement/);
    });
  });
});
