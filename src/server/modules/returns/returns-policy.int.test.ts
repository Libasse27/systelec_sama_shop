import { randomUUID } from "node:crypto";
import { beforeEach, describe, expect, it } from "vitest";
import type { Actor } from "@/server/authz/service";
import { syncRolesAndPermissions } from "@/server/authz/sync";
import { db } from "@/server/db/client";
import { updateSetting } from "@/server/modules/settings/service";
import { settingsDefaults } from "@/server/modules/settings/schemas";
import { resetDatabase } from "../../../../tests/setup/db";
import { actorWith } from "../../../../tests/support/actors";
import { closedPickupOrder, seedOrderCatalog, type OrderFixtures, type PlacedOrder } from "../../../../tests/support/orders";
import { notifyOverdueReturns } from "./overdue";
import { processingDueAt } from "./policy";
import { getReturn, listReturns } from "./queries";
import { answerReturnVerification, createReturn, decideReturn, refundReturn, requestReturnVerification } from "./service";

const HOUR = 3_600_000;

let fixtures: OrderFixtures;
let manager: Actor;
let decider: Actor;
let cashier: Actor;

async function declare(order: PlacedOrder, actor: Actor = manager) {
  const item = await db.orderItem.findFirstOrThrow({ where: { orderId: order.id, sku: "RT-01" }, select: { id: true } });
  return createReturn(db, actor, order.id, { idempotencyKey: randomUUID(), reason: "Écran fissuré à la livraison", items: [{ orderItemId: item.id, quantity: 1 }] });
}

/** Commande remise au client il y a `hours` heures. */
async function handedOverHoursAgo(hours: number): Promise<PlacedOrder> {
  const order = await closedPickupOrder(fixtures, manager, cashier);
  await db.order.update({ where: { id: order.id }, data: { closedAt: new Date(Date.now() - hours * HOUR) } });
  return order;
}

const returnRow = (id: string) => db.return.findUniqueOrThrow({ where: { id } });
const acceptInput = { decision: "ACCEPT", restock: true, refundAmount: 25_000, note: "Défaut confirmé à l'inspection" } as const;

describe("politique de retours, décision 2 (PostgreSQL)", () => {
  beforeEach(async () => {
    await resetDatabase();
    await syncRolesAndPermissions(db);
    fixtures = await seedOrderCatalog();
    manager = await actorWith("ORDER_MANAGER");
    decider = await actorWith("ORDER_MANAGER");
    cashier = await actorWith("FINANCE_MANAGER");
  });

  describe("délai de déclaration (48 h après la remise) et exceptions", () => {
    it("dans le délai : date de remise et échéance posées par la base, pas d'indicateur", async () => {
      const order = await handedOverHoursAgo(47);
      const created = await declare(order);
      expect(created.lateDeclaration).toBe(false);
      const row = await returnRow(created.id);
      const closedAt = (await db.order.findUniqueOrThrow({ where: { id: order.id } })).closedAt!;
      expect(row.handedOverAt).toEqual(closedAt);
      expect(row.declarationDeadline).toEqual(new Date(closedAt.getTime() + 48 * HOUR));
    });

    it("hors délai : enregistré quand même, marqué, filtrable ; accepté seulement avec une exception motivée", async () => {
      const late = await declare(await handedOverHoursAgo(49));
      const onTime = await declare(await handedOverHoursAgo(1));
      expect(late.lateDeclaration).toBe(true);
      expect((await listReturns(db, manager, { late: true })).rows.map((row) => row.number)).toEqual([late.number]);
      expect((await listReturns(db, manager)).total).toBe(2);

      await expect(decideReturn(db, decider, late.id, acceptInput)).rejects.toMatchObject({
        code: "VALIDATION",
        details: { fieldErrors: { exceptionGround: expect.any(Array), exceptionNote: expect.any(Array) } },
      });
      await expect(decideReturn(db, decider, late.id, { ...acceptInput, exceptionGround: "WARRANTY" })).rejects.toMatchObject({ code: "VALIDATION" });
      expect((await returnRow(late.id)).status).toBe("RECEIVED");

      await decideReturn(db, decider, late.id, { ...acceptInput, exceptionGround: "HIDDEN_DEFECT", exceptionNote: "Défaut interne apparu à l'usage, non visible à la remise" });
      expect(await returnRow(late.id)).toMatchObject({ status: "REFUND_PENDING", exceptionGround: "HIDDEN_DEFECT", lateDeclaration: true });
      const event = await db.returnEvent.findFirstOrThrow({ where: { returnId: late.id, type: "ACCEPTED" } });
      expect(event.details).toMatchObject({ exceptionGround: "HIDDEN_DEFECT", refundAmount: 25_000 });

      // Dans le délai : l'exception n'a pas lieu d'être, elle n'est pas enregistrée.
      await decideReturn(db, decider, onTime.id, { ...acceptInput, exceptionGround: "OTHER", exceptionNote: "Inutile" });
      expect(await returnRow(onTime.id)).toMatchObject({ exceptionGround: null, exceptionNote: null });
    });

    it("hors délai refusé : sans exception", async () => {
      const late = await declare(await handedOverHoursAgo(72));
      expect((await decideReturn(db, decider, late.id, { decision: "REJECT", note: "Délai dépassé, aucun défaut constaté" })).status).toBe("REJECTED");
    });

    it("en base : délai et indicateur recalculés à l'insertion, figés ; acceptation hors délai sans exception refusée", async () => {
      const order = await handedOverHoursAgo(50);
      const created = await declare(order);
      await expect(db.return.update({ where: { id: created.id }, data: { lateDeclaration: false } })).rejects.toThrow(/contenu ne se modifie pas/);
      await expect(db.return.update({ where: { id: created.id }, data: { declarationDeadline: new Date() } })).rejects.toThrow(/contenu ne se modifie pas/);
      await expect(
        db.return.update({
          where: { id: created.id },
          data: { status: "COMPLETED", restocked: false, decidedAt: new Date(), decidedById: decider.id, decisionNote: "Sans exception" },
        }),
      ).rejects.toThrow(/motif d'exception obligatoires/);
      await expect(db.return.update({ where: { id: created.id }, data: { exceptionGround: "WARRANTY", exceptionNote: "Avant décision" } })).rejects.toThrow(/returns_exception_check/);
    });
  });

  describe("validation indépendante", () => {
    it("la personne qui déclare ne peut ni accepter ni refuser : refus journalisé ; un autre responsable décide", async () => {
      const created = await declare(await handedOverHoursAgo(1), decider);
      await expect(decideReturn(db, decider, created.id, acceptInput)).rejects.toMatchObject({ code: "FORBIDDEN" });
      await expect(decideReturn(db, decider, created.id, { decision: "REJECT", note: "Refus" })).rejects.toMatchObject({ code: "FORBIDDEN" });
      expect(await db.auditLog.count({ where: { action: "authz.denied", entityType: "Return", entityId: created.id, result: "DENIED", actorId: decider.id } })).toBe(2);
      expect(await returnRow(created.id)).toMatchObject({ status: "RECEIVED", decidedById: null, firstActionAt: null });

      expect((await decideReturn(db, manager, created.id, acceptInput)).status).toBe("REFUND_PENDING");
      expect((await returnRow(created.id)).decidedById).toBe(manager.id);
    });

    it("deux responsables simultanés : une seule décision", async () => {
      const created = await declare(await handedOverHoursAgo(1));
      const other = await actorWith("ADMIN");
      const results = await Promise.allSettled([
        decideReturn(db, decider, created.id, acceptInput),
        decideReturn(db, other, created.id, { decision: "REJECT", note: "Articles utilisés" }),
      ]);
      expect(results.filter((result) => result.status === "fulfilled")).toHaveLength(1);
      expect(await db.returnEvent.count({ where: { returnId: created.id, type: { in: ["ACCEPTED", "REJECTED"] } } })).toBe(1);
    });

    it("en base : décision par le déclarant refusée, même par SQL direct", async () => {
      const created = await declare(await handedOverHoursAgo(1));
      await expect(
        db.return.update({ where: { id: created.id }, data: { status: "REJECTED", decidedAt: new Date(), decidedById: manager.id, decisionNote: "Contournement" } }),
      ).rejects.toThrow(/ne peut pas le décider/);
    });
  });

  describe("vérification avant décision", () => {
    it("demande (nature, commentaire), réponse, puis décision ; la vérification est la première action", async () => {
      const order = await handedOverHoursAgo(1);
      const created = await declare(order);
      await expect(requestReturnVerification(db, cashier, created.id, { kind: "PHOTOS", request: "Photos de l'écran" })).rejects.toMatchObject({ code: "FORBIDDEN" });
      await expect(requestReturnVerification(db, decider, created.id, { kind: "SELFIE", request: "x" })).rejects.toMatchObject({ code: "VALIDATION" });
      // Le déclarant (qui a returns.decide) ne peut pas « commencer » lui-même le traitement.
      await expect(requestReturnVerification(db, manager, created.id, { kind: "PHOTOS", request: "Photos" })).rejects.toMatchObject({ code: "FORBIDDEN" });
      expect(await returnRow(created.id)).toMatchObject({ status: "RECEIVED", firstActionAt: null });

      await requestReturnVerification(db, decider, created.id, { kind: "PHOTOS", request: "Photos de l'écran fissuré et de l'emballage" });
      const verifying = await returnRow(created.id);
      expect(verifying).toMatchObject({ status: "VERIFICATION", decidedAt: null });
      expect(verifying.firstActionAt).not.toBeNull();
      expect((await db.order.findUniqueOrThrow({ where: { id: order.id } })).paymentStatus).toBe("TO_VERIFY");
      expect((await getReturn(db, manager, created.id))?.pendingVerification).toMatchObject({ kind: "PHOTOS", request: "Photos de l'écran fissuré et de l'emballage" });

      await expect(decideReturn(db, decider, created.id, acceptInput)).rejects.toThrow(/vérification est en attente/);
      await expect(requestReturnVerification(db, decider, created.id, { kind: "INVOICE", request: "Facture" })).rejects.toThrow(/déjà en attente/);
      // Validation indépendante : le déclarant ne fournit pas lui-même le résultat (refus journalisé) ;
      // sans returns.decide, refusé aussi.
      await expect(answerReturnVerification(db, manager, created.id, { response: "Tout va bien" })).rejects.toMatchObject({ code: "FORBIDDEN" });
      await expect(answerReturnVerification(db, cashier, created.id, { response: "Tout va bien" })).rejects.toMatchObject({ code: "FORBIDDEN" });
      expect(await db.auditLog.count({ where: { action: "authz.denied", entityType: "Return", entityId: created.id, actorId: manager.id } })).toBe(2);
      expect((await returnRow(created.id)).status).toBe("VERIFICATION");
      await answerReturnVerification(db, decider, created.id, { response: "Photos reçues : fissure en coin, emballage intact" });
      expect((await returnRow(created.id)).status).toBe("RECEIVED");
      await expect(answerReturnVerification(db, decider, created.id, { response: "Encore" })).rejects.toThrow(/Aucune vérification/);

      await decideReturn(db, decider, created.id, acceptInput);
      const events = await db.returnEvent.findMany({ where: { returnId: created.id }, orderBy: [{ createdAt: "asc" }, { id: "asc" }] });
      expect(events.map((event) => [event.type, event.toStatus])).toEqual([
        ["DECLARED", "RECEIVED"],
        ["VERIFICATION_REQUESTED", "VERIFICATION"],
        ["VERIFICATION_ANSWERED", "RECEIVED"],
        ["ACCEPTED", "REFUND_PENDING"],
      ]);
      expect(events[1]).toMatchObject({ verificationKind: "PHOTOS", actorId: decider.id });
      expect(await db.auditLog.count({ where: { entityId: created.id, action: { in: ["return.verification.request", "return.verification.answer"] } } })).toBe(2);
    });
  });

  describe("historique propre au retour", () => {
    it("parcours complet tracé (qui, quand, statut, motif, décision) et affiché sur la fiche", async () => {
      const created = await declare(await handedOverHoursAgo(1));
      await decideReturn(db, decider, created.id, acceptInput);
      const { receiptNumber } = await refundReturn(db, cashier, created.id, { idempotencyKey: randomUUID() });
      const view = await getReturn(db, manager, created.id);
      expect(view?.events.map((event) => [event.type, event.actorName, event.toStatus])).toEqual([
        ["DECLARED", "ORDER_MANAGER", "RECEIVED"],
        ["ACCEPTED", "ORDER_MANAGER", "REFUND_PENDING"],
        ["REFUNDED", "FINANCE_MANAGER", "COMPLETED"],
      ]);
      expect(view?.events[1]?.comment).toBe("Défaut confirmé à l'inspection");
      expect(view?.events[2]?.details).toMatchObject({ receiptNumber, amount: 25_000 });
    });

    it("en base : ajout seul, et chaque étape reflète le statut du retour", async () => {
      const created = await declare(await handedOverHoursAgo(1));
      const event = await db.returnEvent.findFirstOrThrow({ where: { returnId: created.id } });
      await expect(db.returnEvent.update({ where: { id: event.id }, data: { comment: "Réécrit" } })).rejects.toThrow(/ajout seul/);
      await expect(db.returnEvent.delete({ where: { id: event.id } })).rejects.toThrow(/ajout seul/);
      await expect(db.returnEvent.create({ data: { returnId: created.id, type: "ACCEPTED", fromStatus: "RECEIVED", toStatus: "COMPLETED", actorId: decider.id, comment: "Faux" } })).rejects.toThrow(
        /différent du statut du retour/,
      );
    });
  });

  describe("délai de traitement : 24 heures ouvrables, alerte unique à l'administrateur", () => {
    it("aucune alerte avant l'échéance ; une seule après ; la demande reste ouverte", async () => {
      const admin = await actorWith("ADMIN");
      await actorWith("SUPER_ADMIN");
      const created = await declare(await handedOverHoursAgo(1));
      const { createdAt } = await returnRow(created.id);
      const due = processingDueAt(createdAt, settingsDefaults.businessHours);

      expect(await notifyOverdueReturns(db, new Date(due.getTime() - 1_000))).toEqual([]);
      expect(await notifyOverdueReturns(db, new Date(due.getTime() + 1_000))).toEqual([created.number]);
      expect(await notifyOverdueReturns(db, new Date(due.getTime() + 48 * HOUR))).toEqual([]);

      const row = await returnRow(created.id);
      expect(row).toMatchObject({ status: "RECEIVED", decidedAt: null, firstActionAt: null });
      expect(row.overdueNotifiedAt).not.toBeNull();
      // Une alerte par administrateur actif (e-mail), aucune au client.
      const alerts = await db.notification.findMany({ where: { returnId: created.id } });
      expect(alerts.map((alert) => alert.template)).toEqual(["return.overdue_staff", "return.overdue_staff"]);
      expect(alerts.map((alert) => alert.recipient)).toContain((await db.user.findUniqueOrThrow({ where: { id: admin.id } })).email);
      expect(await db.returnEvent.count({ where: { returnId: created.id, type: "OVERDUE_NOTIFIED", actorId: null } })).toBe(1);
      expect(await db.auditLog.count({ where: { action: "return.overdue", entityId: created.id, actorId: null } })).toBe(1);
      const view = await getReturn(db, manager, created.id);
      expect(view?.processingOverdue).toBe(true);

      // Toujours décidable ensuite, et l'alerte ne se réécrit pas.
      await decideReturn(db, decider, created.id, acceptInput);
      await expect(db.return.update({ where: { id: created.id }, data: { overdueNotifiedAt: null } })).rejects.toThrow(/délais ne se modifie pas/);
    });

    it("idempotente même lancée deux fois en parallèle", async () => {
      await actorWith("ADMIN");
      const created = await declare(await handedOverHoursAgo(1));
      const later = new Date(Date.now() + 30 * 24 * HOUR);
      const runs = await Promise.all([notifyOverdueReturns(db, later), notifyOverdueReturns(db, later)]);
      expect(runs.flat()).toEqual([created.number]);
      expect(await db.notification.count({ where: { returnId: created.id } })).toBe(1);
    });

    it("pas d'alerte si le traitement a commencé (vérification demandée) ni pour un retour décidé", async () => {
      await actorWith("ADMIN");
      const verifying = await declare(await handedOverHoursAgo(1));
      await requestReturnVerification(db, decider, verifying.id, { kind: "INSPECTION", request: "Apporter l'appareil en boutique" });
      const decided = await declare(await handedOverHoursAgo(1));
      await decideReturn(db, decider, decided.id, { decision: "REJECT", note: "Aucun défaut" });
      expect(await notifyOverdueReturns(db, new Date(Date.now() + 30 * 24 * HOUR))).toEqual([]);
    });

    it("sans administrateur actif joignable : rien n'est marqué, l'alerte part au passage suivant", async () => {
      const created = await declare(await handedOverHoursAgo(1));
      const later = new Date(Date.now() + 30 * 24 * HOUR);
      expect(await notifyOverdueReturns(db, later)).toEqual([]);
      expect((await returnRow(created.id)).overdueNotifiedAt).toBeNull();
      await actorWith("ADMIN");
      expect(await notifyOverdueReturns(db, later)).toEqual([created.number]);
    });

    it("suit le paramètre des heures ouvrables", async () => {
      await actorWith("ADMIN");
      const created = await declare(await handedOverHoursAgo(1));
      const { createdAt } = await returnRow(created.id);
      const after25h = new Date(createdAt.getTime() + 25 * HOUR);
      // Par défaut (10 h par jour), 24 heures ouvrables ne sont pas écoulées en 25 heures.
      expect(await notifyOverdueReturns(db, after25h)).toEqual([]);
      await updateSetting("businessHours", { days: [1, 2, 3, 4, 5, 6, 7], ranges: [{ start: "00:00", end: "23:59" }] }, null, db);
      expect(await notifyOverdueReturns(db, after25h)).toEqual([created.number]);
    });
  });
});
