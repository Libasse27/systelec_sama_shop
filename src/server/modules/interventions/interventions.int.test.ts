import { randomUUID } from "node:crypto";
import { beforeEach, describe, expect, it } from "vitest";
import type { Actor } from "@/server/authz/service";
import { syncRolesAndPermissions } from "@/server/authz/sync";
import { db } from "@/server/db/client";
import { getInvoice, issueInvoice } from "@/server/modules/invoices/service";
import { renderInvoicePdf } from "@/server/modules/invoices/invoice-pdf";
import { accessToken } from "@/server/modules/orders/access-token";
import { getReceipt } from "@/server/modules/payments/queries";
import { recordInterventionPayment, voidPayment } from "@/server/modules/payments/service";
import { getQuoteForViewer, getRequestForViewer } from "@/server/modules/quotes/queries";
import { submitQuoteRequest } from "@/server/modules/quotes/requests";
import { listSchedulableTechnicians, listTechnicians, saveTechnicianProfile } from "@/server/modules/technicians/service";
import { resetDatabase } from "../../../../tests/setup/db";
import { actorWith } from "../../../../tests/support/actors";
import { acceptedIntervention, dayIn, QUOTE_TOTAL, requestInput, seedService, technician } from "../../../../tests/support/services";
import { addPart, removePart } from "./parts";
import { getAdminIntervention, getPlanning, listAdminInterventions } from "./queries";
import { cancelIntervention, completeIntervention, createDirectIntervention, saveReport, scheduleIntervention, startIntervention } from "./workflow";

let manager: Actor;

const slot = (technicianId: string, time = "09:00", durationMinutes = 120, date = dayIn(3)) => ({ technicianId, date, time, durationMinutes });
const report = { diagnosis: "Câblage existant vétuste", workDone: "Pose de 4 caméras et de l'enregistreur", timeSpentMin: 240 };
const stateOf = (id: string) => db.intervention.findUniqueOrThrow({ where: { id }, select: { status: true, amountPaid: true, paymentStatus: true, technicianId: true } });

async function seedPartStock(onHand: number): Promise<string> {
  const category = await db.category.create({ data: { name: "Vidéo", slug: `video-${randomUUID().slice(0, 6)}` } });
  await db.product.create({
    data: {
      name: "Câble coaxial",
      slug: `cable-${randomUUID().slice(0, 6)}`,
      categoryId: category.id,
      shortDescription: "Court",
      description: "Long",
      variants: { create: { sku: "CAB-50", name: "50 m", price: 15_000, costPrice: 9_000, isDefault: true, inventory: { create: { onHand } } } },
    },
  });
  return "CAB-50";
}

/** Intervention acceptée, planifiée pour le technicien et démarrée. */
async function startedIntervention(tech: { actor: Actor; technicianId: string }) {
  const accepted = await acceptedIntervention(manager);
  await scheduleIntervention(db, manager, accepted.intervention.id, slot(tech.technicianId));
  await startIntervention(db, tech.actor, accepted.intervention.id);
  return accepted;
}

async function doneIntervention(tech: { actor: Actor; technicianId: string }) {
  const started = await startedIntervention(tech);
  await saveReport(db, tech.actor, started.intervention.id, report);
  await completeIntervention(db, tech.actor, started.intervention.id, { customerSignOff: "M. Sow" });
  return started;
}

describe("interventions techniques (§20 n° 20 et 21, PostgreSQL)", () => {
  beforeEach(async () => {
    await resetDatabase();
    await syncRolesAndPermissions(db);
    await seedService();
    manager = await actorWith("TECH_MANAGER");
  });

  describe("techniciens et planning", () => {
    it("profil technicien réservé aux comptes portant le rôle ; seuls les actifs sont planifiables", async () => {
      const active = await technician(manager);
      const inactive = await technician(manager);
      await db.technician.update({ where: { id: inactive.technicianId }, data: { isActive: false } });
      expect((await listTechnicians(db, manager)).map((row) => row.isActive).sort()).toEqual([false, true]);
      expect((await listSchedulableTechnicians(db)).map((row) => row.id)).toEqual([active.technicianId]);
      await expect(saveTechnicianProfile(db, manager, (await actorWith("ORDER_MANAGER")).id, { isActive: true })).rejects.toMatchObject({ code: "NOT_FOUND" });
      const { intervention } = await acceptedIntervention(manager);
      await expect(scheduleIntervention(db, manager, intervention.id, slot(inactive.technicianId))).rejects.toThrow(/pas disponible/);
    });

    it("planifie un créneau ; refuse un chevauchement pour le même technicien, même simultané", async () => {
      const tech = await technician(manager);
      const other = await technician(manager);
      const first = (await acceptedIntervention(manager)).intervention;
      const second = (await acceptedIntervention(manager)).intervention;
      const third = (await acceptedIntervention(manager)).intervention;

      await scheduleIntervention(db, manager, first.id, slot(tech.technicianId, "09:00", 120));
      expect(await stateOf(first.id)).toMatchObject({ status: "SCHEDULED", technicianId: tech.technicianId });
      expect(await db.notification.count({ where: { interventionId: first.id, template: "intervention.scheduled" } })).toBe(2);
      await expect(scheduleIntervention(db, manager, second.id, slot(tech.technicianId, "10:30", 60))).rejects.toThrow(/déjà un rendez-vous/);
      // Bord à bord : autorisé ([début, fin[).
      await scheduleIntervention(db, manager, second.id, slot(tech.technicianId, "11:00", 60));
      // Même créneau, autre technicien : autorisé.
      await scheduleIntervention(db, manager, third.id, slot(other.technicianId, "09:00", 120));

      const a = (await acceptedIntervention(manager)).intervention;
      const b = (await acceptedIntervention(manager)).intervention;
      const results = await Promise.allSettled([
        scheduleIntervention(db, manager, a.id, slot(tech.technicianId, "14:00", 60)),
        scheduleIntervention(db, manager, b.id, slot(tech.technicianId, "14:30", 60)),
      ]);
      expect(results.filter((result) => result.status === "fulfilled")).toHaveLength(1);
    });

    it("replanifier remplace le créneau ; un créneau passé est refusé ; le planning liste les rendez-vous", async () => {
      const tech = await technician(manager);
      const { intervention } = await acceptedIntervention(manager);
      await scheduleIntervention(db, manager, intervention.id, slot(tech.technicianId, "09:00"));
      await scheduleIntervention(db, manager, intervention.id, slot(tech.technicianId, "15:00"));
      expect(await db.appointment.count({ where: { interventionId: intervention.id } })).toBe(1);
      await expect(scheduleIntervention(db, manager, intervention.id, slot(tech.technicianId, "09:00", 60, "2020-01-01"))).rejects.toThrow(/déjà passé/);

      const planning = await getPlanning(db, manager, { from: new Date(), to: new Date(Date.now() + 7 * 24 * 3600 * 1000) });
      expect(planning).toMatchObject([{ interventionNumber: intervention.number, technician: "TECHNICIAN", customerName: "Fatou Sow" }]);
      expect(await getPlanning(db, (await technician(manager)).actor, { from: new Date(), to: new Date(Date.now() + 7 * 24 * 3600 * 1000) })).toEqual([]);
      await expect(getPlanning(db, manager, { from: new Date(), to: new Date(Date.now() + 60 * 24 * 3600 * 1000) })).rejects.toMatchObject({ code: "VALIDATION" });
    });
  });

  describe("technicien assigné", () => {
    it("le technicien assigné démarre, rédige le rapport et termine ; un autre technicien est refusé", async () => {
      const tech = await technician(manager);
      const intruder = await technician(manager);
      const { intervention, quote } = await acceptedIntervention(manager);
      await scheduleIntervention(db, manager, intervention.id, slot(tech.technicianId));

      await expect(startIntervention(db, intruder.actor, intervention.id)).rejects.toMatchObject({ code: "FORBIDDEN" });
      await expect(getAdminIntervention(db, intruder.actor, intervention.id)).rejects.toMatchObject({ code: "FORBIDDEN" });
      expect((await listAdminInterventions(db, intruder.actor)).rows).toEqual([]);
      expect((await listAdminInterventions(db, tech.actor)).rows.map((row) => row.number)).toEqual([intervention.number]);
      // Ni planifier ni annuler pour un technicien.
      await expect(scheduleIntervention(db, tech.actor, intervention.id, slot(tech.technicianId, "16:00"))).rejects.toMatchObject({ code: "FORBIDDEN" });
      await expect(cancelIntervention(db, tech.actor, intervention.id, { reason: "Indisponible" })).rejects.toMatchObject({ code: "FORBIDDEN" });
      expect(await db.auditLog.count({ where: { result: "DENIED", actorId: intruder.actor.id } })).toBeGreaterThan(0);

      await startIntervention(db, tech.actor, intervention.id);
      await expect(completeIntervention(db, tech.actor, intervention.id, { customerSignOff: "M. Sow" })).rejects.toThrow(/rapport/);
      await saveReport(db, tech.actor, intervention.id, report);
      await expect(completeIntervention(db, tech.actor, intervention.id, { customerSignOff: "" })).rejects.toMatchObject({ code: "VALIDATION" });
      await completeIntervention(db, tech.actor, intervention.id, { customerSignOff: "M. Sow" });

      expect(await stateOf(intervention.id)).toMatchObject({ status: "DONE" });
      expect(await db.notification.count({ where: { interventionId: intervention.id, template: "intervention.done" } })).toBe(2);
      // Le client suit l'avancement depuis son devis.
      const view = await getQuoteForViewer(db, { userId: null, token: accessToken("quote", quote.id) }, quote.number);
      expect(view!.intervention).toMatchObject({ status: "DONE", appointment: { technician: "TECHNICIAN" } });
      await expect(saveReport(db, tech.actor, intervention.id, report)).rejects.toMatchObject({ code: "CONFLICT" });
    });

    it("pièces : sortie de stock tracée, refus si stock insuffisant, retour en stock si retirée ; coût masqué au technicien", async () => {
      const sku = await seedPartStock(5);
      const tech = await technician(manager);
      const { intervention } = await startedIntervention(tech);

      await addPart(db, tech.actor, intervention.id, { sku: "cab-50", quantity: 2 });
      await addPart(db, tech.actor, intervention.id, { label: "Chevilles", quantity: 20 });
      await expect(addPart(db, tech.actor, intervention.id, { sku, quantity: 4 })).rejects.toThrow(/Stock insuffisant pour cette référence/);
      await expect(addPart(db, tech.actor, intervention.id, { sku: "INCONNU", quantity: 1 })).rejects.toMatchObject({ code: "NOT_FOUND" });
      await expect(addPart(db, tech.actor, intervention.id, { quantity: 1 })).rejects.toMatchObject({ code: "VALIDATION" });

      const inventory = () => db.inventory.findFirstOrThrow({ where: { variant: { sku } }, select: { onHand: true } });
      expect(await inventory()).toEqual({ onHand: 3 });
      const movement = await db.stockMovement.findFirstOrThrow({ where: { variant: { sku } } });
      expect(movement).toMatchObject({ type: "OUT", quantity: -2, reason: `Pièce intervention ${intervention.number}` });

      const forTech = await getAdminIntervention(db, tech.actor, intervention.id);
      expect(forTech!.parts.map((part) => part.unitCost)).toEqual([null, null]);
      expect(forTech!.internalCost).toBeNull();
      const forManager = await getAdminIntervention(db, manager, intervention.id);
      expect(forManager!.internalCost).toBe(18_000);

      await removePart(db, tech.actor, forManager!.parts[0]!.id);
      expect(await inventory()).toEqual({ onHand: 5 });
    });
  });

  describe("annulation et intervention sans devis", () => {
    it("annulation motivée par le responsable : le créneau est libéré", async () => {
      const tech = await technician(manager);
      const cancelled = (await acceptedIntervention(manager)).intervention;
      await scheduleIntervention(db, manager, cancelled.id, slot(tech.technicianId));
      await expect(cancelIntervention(db, manager, cancelled.id, { reason: "" })).rejects.toMatchObject({ code: "VALIDATION" });
      await cancelIntervention(db, manager, cancelled.id, { reason: "Client injoignable" });
      expect(await stateOf(cancelled.id)).toMatchObject({ status: "CANCELLED" });
      const next = (await acceptedIntervention(manager)).intervention;
      await scheduleIntervention(db, manager, next.id, slot(tech.technicianId));
      await expect(cancelIntervention(db, manager, cancelled.id, { reason: "Encore" })).rejects.toThrow(/annulée/);
    });

    it("annuler une intervention en cours remet en stock les pièces du catalogue déjà sorties", async () => {
      const sku = await seedPartStock(5);
      const tech = await technician(manager);
      const { intervention } = await startedIntervention(tech);
      await addPart(db, tech.actor, intervention.id, { sku, quantity: 3 });
      await addPart(db, tech.actor, intervention.id, { label: "Chevilles", quantity: 10 });
      await cancelIntervention(db, manager, intervention.id, { reason: "Client a changé d'avis" });
      expect(await db.inventory.findFirstOrThrow({ where: { variant: { sku } }, select: { onHand: true } })).toEqual({ onHand: 5 });
      expect(await db.stockMovement.findFirstOrThrow({ where: { variant: { sku }, type: "IN" } })).toMatchObject({ quantity: 3 });
    });

    it("intervention à prix fixe créée depuis une demande, sans devis", async () => {
      const request = await submitQuoteRequest(db, { userId: null }, requestInput());
      const created = await createDirectIntervention(db, manager, request.id, { amountDue: 25_000, problem: "Remplacement d'un disjoncteur" });
      expect(await db.intervention.findUniqueOrThrow({ where: { id: created.id } })).toMatchObject({ amountDue: 25_000, quoteId: null, status: "TO_SCHEDULE" });
      expect((await db.quoteRequest.findUniqueOrThrow({ where: { id: request.id } })).status).toBe("ACCEPTED");
      await expect(createDirectIntervention(db, manager, request.id, { amountDue: 1, problem: "Doublon de test" })).rejects.toThrow(/close/);
    });
  });

  describe("encaissement après prestation et facture (§20 n° 21)", () => {
    it("ne s'encaisse qu'une fois terminée ; reçu visible de l'invité avec le lien de son devis", async () => {
      const tech = await technician(manager);
      const started = await startedIntervention(tech);
      const pay = (amount: number) => recordInterventionPayment(db, manager, started.intervention.id, { amount, idempotencyKey: randomUUID() });
      await expect(pay(QUOTE_TOTAL)).rejects.toThrow(/après la prestation/);

      await saveReport(db, tech.actor, started.intervention.id, report);
      await completeIntervention(db, tech.actor, started.intervention.id, { customerSignOff: "M. Sow" });
      await expect(pay(QUOTE_TOTAL + 1)).rejects.toThrow(/dépasse le reste à payer/);
      const { id: paymentId, receiptNumber } = await pay(QUOTE_TOTAL);
      expect(await stateOf(started.intervention.id)).toMatchObject({ amountPaid: QUOTE_TOTAL, paymentStatus: "PAID" });
      expect(await db.notification.count({ where: { interventionId: started.intervention.id, template: "intervention.payment" } })).toBe(2);

      const token = accessToken("quote", started.quote.id);
      expect(await getReceipt(db, { user: null, token }, receiptNumber)).toMatchObject({ document: { label: "Intervention", number: started.intervention.number, total: QUOTE_TOTAL } });
      // Le lien de la demande (même demandeur) l'ouvre aussi ; un jeton d'une autre portée, jamais.
      expect(await getReceipt(db, { user: null, token: started.request.accessToken! }, receiptNumber)).not.toBeNull();
      expect(await getReceipt(db, { user: null, token: accessToken("order", started.intervention.id) }, receiptNumber)).toBeNull();
      expect(await getReceipt(db, { user: tech.actor }, receiptNumber)).toBeNull();

      await voidPayment(db, await actorWith("FINANCE_MANAGER"), paymentId, { reason: "Erreur de saisie" });
      expect(await stateOf(started.intervention.id)).toMatchObject({ amountPaid: 0, paymentStatus: "UNPAID" });
      await expect(db.intervention.update({ where: { id: started.intervention.id }, data: { amountPaid: 10 } })).rejects.toThrow(/différent de la somme/);
    });

    it("facture : émise une fois l'intervention terminée, lignes du devis figées, PDF, accès contrôlé", async () => {
      const tech = await technician(manager);
      const { intervention } = await startedIntervention(tech);
      await expect(issueInvoice(db, manager, intervention.id)).rejects.toThrow(/terminée/);
      await saveReport(db, tech.actor, intervention.id, report);
      await completeIntervention(db, tech.actor, intervention.id, { customerSignOff: "M. Sow" });
      await expect(issueInvoice(db, tech.actor, intervention.id)).rejects.toMatchObject({ code: "FORBIDDEN" });

      const { number } = await issueInvoice(db, manager, intervention.id);
      expect(number).toMatch(/^FAC-\d{4}-000001$/);
      await expect(issueInvoice(db, manager, intervention.id)).rejects.toThrow(/déjà émise/);
      const invoice = await getInvoice(db, { user: manager }, number);
      expect(invoice).toMatchObject({ total: QUOTE_TOTAL, interventionNumber: intervention.number, customer: { name: "Fatou Sow" } });
      expect(invoice!.lines.map((line) => line.lineTotal)).toEqual([140_000, 40_000]);
      const pdf = await renderInvoicePdf(invoice!);
      expect(pdf.subarray(0, 5).toString()).toBe("%PDF-");

      const saved = await db.invoice.findUniqueOrThrow({ where: { number } });
      await expect(db.invoice.update({ where: { id: saved.id }, data: { total: 1 } })).rejects.toThrow();
      expect(await getInvoice(db, { user: null, token: "faux" }, number)).toBeNull();
      expect(await getInvoice(db, { user: await actorWith("ORDER_MANAGER") }, number)).not.toBeNull(); // payments.read
      expect(await getInvoice(db, { user: await actorWith("CATALOG_MANAGER") }, number)).toBeNull();
    });

    it("intervention à prix fixe : l'invité ouvre facture et reçu avec le lien de sa demande", async () => {
      const tech = await technician(manager);
      const request = await submitQuoteRequest(db, { userId: null }, requestInput());
      const { id } = await createDirectIntervention(db, manager, request.id, { amountDue: 25_000, problem: "Remplacement d'un disjoncteur" });
      await scheduleIntervention(db, manager, id, slot(tech.technicianId));
      await startIntervention(db, tech.actor, id);
      await saveReport(db, tech.actor, id, report);
      await completeIntervention(db, tech.actor, id, { customerSignOff: "Mme Ba" });
      const { receiptNumber } = await recordInterventionPayment(db, manager, id, { amount: 25_000, idempotencyKey: randomUUID() });
      const { number } = await issueInvoice(db, manager, id);

      const token = request.accessToken!;
      expect(await getInvoice(db, { user: null, token }, number)).not.toBeNull();
      expect(await getReceipt(db, { user: null, token }, receiptNumber)).not.toBeNull();
      expect(await getInvoice(db, { user: null, token: accessToken("quote", id) }, number)).toBeNull();
      expect((await getRequestForViewer(db, { userId: null, token }, request.number))!.directIntervention).toMatchObject({
        status: "DONE",
        paymentStatus: "PAID",
        invoiceNumber: number,
      });
    });

    it("facture d'une intervention à prix fixe : une ligne au montant convenu", async () => {
      const tech = await technician(manager);
      const request = await submitQuoteRequest(db, { userId: null }, requestInput());
      const { id } = await createDirectIntervention(db, manager, request.id, { amountDue: 25_000, problem: "Remplacement d'un disjoncteur" });
      await scheduleIntervention(db, manager, id, slot(tech.technicianId));
      await startIntervention(db, tech.actor, id);
      await saveReport(db, tech.actor, id, report);
      await completeIntervention(db, tech.actor, id, { customerSignOff: "Mme Ba" });
      const { number } = await issueInvoice(db, manager, id);
      expect((await getInvoice(db, { user: manager }, number))!.lines).toEqual([
        { label: "Installation de caméras", quantity: 1, unitPrice: 25_000, lineTotal: 25_000 },
      ]);
    });

    it("parcours complet : une intervention terminée garde son rapport, ses pièces et son encaissement", async () => {
      const tech = await technician(manager);
      const { intervention } = await doneIntervention(tech);
      const detail = await getAdminIntervention(db, manager, intervention.id);
      expect(detail).toMatchObject({ status: "DONE", customerSignOff: "M. Sow", report: { timeSpentMin: 240 }, canManage: true });
    });
  });
});
