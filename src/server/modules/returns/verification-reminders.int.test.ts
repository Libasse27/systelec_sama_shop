import { randomUUID } from "node:crypto";
import { beforeEach, describe, expect, it } from "vitest";
import type { ReturnVerificationKind } from "@/generated/prisma/client";
import type { Actor } from "@/server/authz/service";
import { syncRolesAndPermissions } from "@/server/authz/sync";
import { db } from "@/server/db/client";
import { settingsDefaults } from "@/server/modules/settings/schemas";
import { updateSetting } from "@/server/modules/settings/service";
import { resetDatabase } from "../../../../tests/setup/db";
import { actorWith } from "../../../../tests/support/actors";
import { closedPickupOrder, contact, seedOrderCatalog, type OrderFixtures } from "../../../../tests/support/orders";
import { getReturnAlerts } from "./queries";
import { reminderDueDates, remindPendingVerifications } from "./reminders";
import { answerReturnVerification, createReturn, requestReturnVerification } from "./service";

const SECOND = 1_000;

let fixtures: OrderFixtures;
let declarer: Actor;
let requester: Actor;
let cashier: Actor;

/** Retour en « vérification demandée » ; renvoie l'identifiant et les échéances des trois paliers. */
async function pendingVerification(kind: ReturnVerificationKind = "PHOTOS") {
  const order = await closedPickupOrder(fixtures, declarer, cashier);
  const item = await db.orderItem.findFirstOrThrow({ where: { orderId: order.id, sku: "RT-01" }, select: { id: true } });
  const created = await createReturn(db, declarer, order.id, { idempotencyKey: randomUUID(), reason: "Écran fissuré", items: [{ orderItemId: item.id, quantity: 1 }] });
  await requestReturnVerification(db, requester, created.id, { kind, request: "Photos de l'écran et de l'emballage" });
  const { verificationRequestedAt } = await db.return.findUniqueOrThrow({ where: { id: created.id } });
  const due = reminderDueDates(verificationRequestedAt!, settingsDefaults.returnReminders, settingsDefaults.businessHours);
  return { id: created.id, number: created.number, due, after: (index: 0 | 1 | 2) => new Date(due[index].getTime() + SECOND) };
}

const row = (id: string) => db.return.findUniqueOrThrow({ where: { id } });
const reminderNotifications = (returnId: string) =>
  db.notification.findMany({ where: { returnId, template: { not: "return.verification_customer" }, NOT: { template: "return.decided_customer" } }, orderBy: { createdAt: "asc" } });
const emailOf = async (actor: Actor) => (await db.user.findUniqueOrThrow({ where: { id: actor.id } })).email;

describe("décision 4 : relances des vérifications sans réponse (PostgreSQL)", () => {
  beforeEach(async () => {
    await resetDatabase();
    await syncRolesAndPermissions(db);
    fixtures = await seedOrderCatalog();
    declarer = await actorWith("ORDER_MANAGER");
    requester = await actorWith("ORDER_MANAGER");
    cashier = await actorWith("FINANCE_MANAGER");
  });

  it("la demande elle-même avertit le client (photos, facture, informations), pas pour une inspection en boutique", async () => {
    const photos = await pendingVerification("PHOTOS");
    const inspection = await pendingVerification("INSPECTION");
    const sentTo = async (id: string) => (await db.notification.findMany({ where: { returnId: id, template: "return.verification_customer" } })).map((n) => n.recipient);
    expect(await sentTo(photos.id)).toEqual([contact.email]);
    expect(await sentTo(inspection.id)).toEqual([]);
  });

  it("12 h : relance 1 (client + responsable) ; 24 h : relance 2 ; 48 h : escalade aux administrateurs ; puis plus rien", async () => {
    const admin = await actorWith("ADMIN");
    const pending = await pendingVerification();

    expect(await remindPendingVerifications(db, new Date(pending.due[0].getTime() - SECOND))).toEqual([]);
    expect(await remindPendingVerifications(db, pending.after(0))).toEqual([{ number: pending.number, stage: 1 }]);
    expect(await remindPendingVerifications(db, pending.after(0))).toEqual([]);
    expect((await row(pending.id)).verificationReminderStage).toBe(1);
    let notifications = await db.notification.findMany({ where: { returnId: pending.id, template: { in: ["return.verification_reminder_staff", "return.verification_customer"] } } });
    expect(notifications.filter((n) => n.template === "return.verification_reminder_staff").map((n) => n.recipient)).toEqual([await emailOf(requester)]);
    // Client : la demande initiale, puis la relance 1.
    expect(notifications.filter((n) => n.template === "return.verification_customer")).toHaveLength(2);

    expect(await remindPendingVerifications(db, pending.after(1))).toEqual([{ number: pending.number, stage: 2 }]);
    expect(await remindPendingVerifications(db, pending.after(2))).toEqual([{ number: pending.number, stage: 3 }]);
    expect(await remindPendingVerifications(db, new Date(pending.due[2].getTime() + 30 * 24 * 3_600 * SECOND))).toEqual([]);

    notifications = await reminderNotifications(pending.id);
    expect(notifications.filter((n) => n.template === "return.verification_escalated_staff").map((n) => n.recipient)).toEqual([await emailOf(admin)]);
    const events = await db.returnEvent.findMany({ where: { returnId: pending.id, actorId: null }, orderBy: [{ createdAt: "asc" }, { id: "asc" }] });
    expect(events.map((event) => [event.type, (event.details as { stage: number }).stage])).toEqual([
      ["VERIFICATION_REMINDED", 1],
      ["VERIFICATION_REMINDED", 2],
      ["VERIFICATION_ESCALATED", 3],
    ]);
    // Jamais d'annulation : la demande reste ouverte et décidable.
    expect(await row(pending.id)).toMatchObject({ status: "VERIFICATION", verificationReminderStage: 3, decidedAt: null });
    expect(await db.auditLog.count({ where: { entityId: pending.id, action: { in: ["return.verification.remind", "return.verification.escalate"] }, actorId: null } })).toBe(3);
  });

  it("notifications internes : le tableau de bord signale relances et escalades, plus rien après la réponse", async () => {
    await actorWith("ADMIN");
    const pending = await pendingVerification();
    expect((await getReturnAlerts(db, declarer)).rows).toEqual([]);
    await remindPendingVerifications(db, pending.after(0));
    expect((await getReturnAlerts(db, declarer)).rows).toMatchObject([{ number: pending.number, kind: "VERIFICATION_REMINDED", stage: 1 }]);
    await remindPendingVerifications(db, pending.after(2));
    expect((await getReturnAlerts(db, declarer)).rows).toMatchObject([{ number: pending.number, kind: "VERIFICATION_ESCALATED", stage: 3 }]);
    await expect(getReturnAlerts(db, await actorWith("COURIER"))).rejects.toMatchObject({ code: "FORBIDDEN" });
    await answerReturnVerification(db, requester, pending.id, { response: "Photos reçues" });
    expect((await getReturnAlerts(db, declarer)).total).toBe(0);
  });

  it("la réponse arrête les relances ; une nouvelle demande repart de zéro", async () => {
    await actorWith("ADMIN");
    const pending = await pendingVerification();
    await remindPendingVerifications(db, pending.after(0));
    await answerReturnVerification(db, requester, pending.id, { response: "Photos reçues en boutique" });
    expect(await row(pending.id)).toMatchObject({ status: "RECEIVED", verificationReminderStage: 0, verificationRequestedAt: null });
    expect(await remindPendingVerifications(db, pending.after(2))).toEqual([]);

    await requestReturnVerification(db, requester, pending.id, { kind: "INVOICE", request: "Facture d'achat" });
    expect(await row(pending.id)).toMatchObject({ status: "VERIFICATION", verificationReminderStage: 0 });
    expect((await row(pending.id)).verificationRequestedAt).not.toBeNull();
  });

  it("tâche lancée en retard : directement le palier atteint, sans rafale de relances", async () => {
    await actorWith("ADMIN");
    const pending = await pendingVerification();
    expect(await remindPendingVerifications(db, pending.after(2))).toEqual([{ number: pending.number, stage: 3 }]);
    expect(await db.returnEvent.count({ where: { returnId: pending.id, type: { in: ["VERIFICATION_REMINDED", "VERIFICATION_ESCALATED"] } } })).toBe(1);
  });

  it("inspection en boutique : seul le responsable est relancé", async () => {
    const pending = await pendingVerification("INSPECTION");
    await remindPendingVerifications(db, pending.after(0));
    expect(await db.notification.count({ where: { returnId: pending.id, template: "return.verification_customer" } })).toBe(0);
    expect(await db.notification.count({ where: { returnId: pending.id, template: "return.verification_reminder_staff" } })).toBe(1);
  });

  it("idempotente même lancée deux fois en parallèle", async () => {
    const pending = await pendingVerification();
    const runs = await Promise.all([remindPendingVerifications(db, pending.after(0)), remindPendingVerifications(db, pending.after(0))]);
    expect(runs.flat()).toEqual([{ number: pending.number, stage: 1 }]);
    expect(await db.notification.count({ where: { returnId: pending.id, template: "return.verification_reminder_staff" } })).toBe(1);
  });

  it("responsable désactivé : les administrateurs sont relancés ; personne de joignable : rien n'est marqué, retenté", async () => {
    const pending = await pendingVerification();
    await db.user.update({ where: { id: requester.id }, data: { isActive: false } });
    expect(await remindPendingVerifications(db, pending.after(0))).toEqual([]);
    expect((await row(pending.id)).verificationReminderStage).toBe(0);

    const admin = await actorWith("ADMIN");
    expect(await remindPendingVerifications(db, pending.after(0))).toEqual([{ number: pending.number, stage: 1 }]);
    expect((await reminderNotifications(pending.id)).map((n) => n.recipient)).toEqual([await emailOf(admin)]);
  });

  it("délais administrables et jours fériés pris en compte", async () => {
    const pending = await pendingVerification();
    const requestedAt = (await row(pending.id)).verificationRequestedAt!;
    await updateSetting("returnReminders", { firstReminderHours: 1, secondReminderHours: 2, escalationHours: 3 }, null, db);
    const holiday = { ...settingsDefaults.businessHours, holidays: [pending.due[0].toISOString().slice(0, 10)] };
    await updateSetting("businessHours", holiday, null, db);
    const [firstDue] = reminderDueDates(requestedAt, { firstReminderHours: 1, secondReminderHours: 2, escalationHours: 3 }, holiday);
    expect(await remindPendingVerifications(db, new Date(firstDue.getTime() - SECOND))).toEqual([]);
    expect(await remindPendingVerifications(db, new Date(firstDue.getTime() + SECOND))).toEqual([{ number: pending.number, stage: 1 }]);
  });

  describe("en base", () => {
    it("palier croissant, date de demande figée, suivi nul hors vérification", async () => {
      const pending = await pendingVerification();
      await db.return.update({ where: { id: pending.id }, data: { verificationReminderStage: 2 } });
      await expect(db.return.update({ where: { id: pending.id }, data: { verificationReminderStage: 1 } })).rejects.toThrow(/suivi des relances/);
      await expect(db.return.update({ where: { id: pending.id }, data: { verificationRequestedAt: new Date() } })).rejects.toThrow(/suivi des relances/);
      await expect(db.return.update({ where: { id: pending.id }, data: { verificationReminderStage: 4 } })).rejects.toThrow(/returns_reminder_check/);

      const order = await closedPickupOrder(fixtures, declarer, cashier);
      const item = await db.orderItem.findFirstOrThrow({ where: { orderId: order.id, sku: "RT-01" }, select: { id: true } });
      const received = await createReturn(db, declarer, order.id, { idempotencyKey: randomUUID(), reason: "Panne", items: [{ orderItemId: item.id, quantity: 1 }] });
      // Hors vérification, la base remet le suivi à zéro (aucune relance ne peut y être posée).
      await db.return.update({ where: { id: received.id }, data: { verificationReminderStage: 1, verificationRequestedAt: new Date() } });
      expect(await row(received.id)).toMatchObject({ verificationReminderStage: 0, verificationRequestedAt: null });
    });
  });
});
