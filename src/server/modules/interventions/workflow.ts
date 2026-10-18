import "server-only";
import { Prisma, type PrismaClient } from "@/generated/prisma/client";
import { businessDateTime, businessYear, formatDateTime } from "@/lib/dates";
import { recordAudit } from "@/server/audit/audit";
import { assertPermission, type Actor } from "@/server/authz/service";
import { AppError } from "@/server/errors";
import type { Contact } from "@/server/modules/orders/schemas";
import { paymentStatusFor } from "@/server/modules/payments/balance";
import { closeOtherQuotes } from "@/server/modules/quotes/quotes";
import { nextBusinessNumber } from "@/server/modules/sequences/service";
import { applyStockMovement } from "@/server/modules/inventory/service";
import { dispatchNotifications, queueNotifications } from "@/server/notifications/queue";
import { parseInput } from "@/server/validation";
import { authorizeWork, lockForWork, type LockedIntervention } from "./access";
import { cancelSchema, completeSchema, directInterventionSchema, reportSchema, scheduleSchema } from "./schemas";

type Tx = Prisma.TransactionClient;

/** Violation de la contrainte d'exclusion du planning (créneaux qui se chevauchent). */
const isOverlap = (error: unknown) =>
  (error instanceof Prisma.PrismaClientKnownRequestError || error instanceof Prisma.PrismaClientUnknownRequestError) &&
  /appointments_no_overlap|23P01/.test(`${error.message} ${"code" in error ? String(error.code) : ""}`);

const notifyCustomer = (tx: Tx, intervention: LockedIntervention, template: "intervention.scheduled" | "intervention.done", extra: object) => {
  const contact = intervention.contact as unknown as Contact;
  return queueNotifications(
    tx,
    { interventionId: intervention.id },
    template,
    { number: intervention.number, customerName: contact.name, ...extra },
    { email: contact.email, phone: contact.phone },
  );
};

/** Intervention créée directement depuis une demande, sans devis (prix fixe convenu ; interventions.manage). */
export async function createDirectIntervention(client: PrismaClient, actor: Actor, quoteRequestId: string, input: unknown): Promise<{ id: string; number: string }> {
  await assertPermission(client, actor, "interventions.manage");
  const { amountDue, problem } = parseInput(directInterventionSchema, input, "Intervention");
  return client.$transaction(async (tx) => {
    const [request] = await tx.$queryRaw<{ id: string }[]>`SELECT id FROM quote_requests WHERE id = ${quoteRequestId} FOR UPDATE`;
    if (!request) throw new AppError("NOT_FOUND", "Demande introuvable.");
    const row = await tx.quoteRequest.findUniqueOrThrow({ where: { id: quoteRequestId }, select: { status: true, customerId: true, serviceId: true, contact: true, address: true } });
    if (row.status === "ACCEPTED" || row.status === "CANCELLED") throw new AppError("CONFLICT", "Cette demande est close.");
    const number = await nextBusinessNumber(tx, "intervention", businessYear());
    const intervention = await tx.intervention.create({
      data: {
        number,
        customerId: row.customerId,
        quoteRequestId,
        serviceId: row.serviceId,
        contact: row.contact as Prisma.InputJsonValue,
        address: row.address,
        problem,
        amountDue,
        paymentStatus: paymentStatusFor(amountDue, 0),
      },
      select: { id: true, number: true },
    });
    await tx.quoteRequest.update({ where: { id: quoteRequestId }, data: { status: "ACCEPTED" } });
    await closeOtherQuotes(tx, quoteRequestId, null);
    await recordAudit(tx, { actorId: actor.id, action: "intervention.create", entityType: "Intervention", entityId: intervention.id, after: { number, amountDue, quoteRequestId } });
    return intervention;
  });
}

/**
 * Planifie (ou replanifie) une intervention sur un créneau d'un technicien actif. La base
 * refuse deux créneaux qui se chevauchent pour un même technicien (contrainte d'exclusion).
 */
export async function scheduleIntervention(client: PrismaClient, actor: Actor, interventionId: string, input: unknown): Promise<void> {
  await authorizeWork(client, actor, interventionId, "manage");
  const slot = parseInput(scheduleSchema, input, "Planification");
  const startsAt = businessDateTime(slot.date, slot.time);
  if (!startsAt) throw new AppError("VALIDATION", "Date ou heure invalide.", { fieldErrors: { date: ["Date ou heure invalide"] } });
  if (startsAt < new Date()) throw new AppError("VALIDATION", "Ce créneau est déjà passé.", { fieldErrors: { date: ["Créneau passé"] } });
  const endsAt = new Date(startsAt.getTime() + slot.durationMinutes * 60_000);
  try {
    await client.$transaction(async (tx) => {
      const intervention = await lockForWork(tx, actor, interventionId, ["TO_SCHEDULE", "SCHEDULED"], "manage");
      const technician = await tx.technician.findFirst({
        where: { id: slot.technicianId, isActive: true, user: { isActive: true } },
        select: { id: true, user: { select: { name: true } } },
      });
      if (!technician) throw new AppError("CONFLICT", "Ce technicien n'est pas disponible.");
      // L'ancien créneau est remplacé : il reste tracé dans l'audit.
      const previous = await tx.appointment.findFirst({ where: { interventionId }, select: { technicianId: true, startsAt: true, endsAt: true } });
      await tx.appointment.deleteMany({ where: { interventionId } });
      await tx.appointment.create({ data: { interventionId, technicianId: technician.id, startsAt, endsAt } });
      await tx.intervention.update({ where: { id: interventionId }, data: { technicianId: technician.id, status: "SCHEDULED" } });
      await notifyCustomer(tx, intervention, "intervention.scheduled", { schedule: formatDateTime(startsAt), technician: technician.user.name });
      await recordAudit(tx, {
        actorId: actor.id,
        action: "intervention.schedule",
        entityType: "Intervention",
        entityId: interventionId,
        before: { status: intervention.status, slot: previous },
        after: { technicianId: technician.id, startsAt, endsAt },
      });
    });
  } catch (error) {
    if (isOverlap(error)) throw new AppError("CONFLICT", "Ce technicien a déjà un rendez-vous sur ce créneau.");
    throw error;
  }
  await dispatchNotifications(client, { interventionId });
}

/** Le technicien assigné (ou le responsable) démarre l'intervention planifiée. */
export async function startIntervention(client: PrismaClient, actor: Actor, interventionId: string): Promise<void> {
  await authorizeWork(client, actor, interventionId);
  await client.$transaction(async (tx) => {
    await lockForWork(tx, actor, interventionId, ["SCHEDULED"]);
    await tx.intervention.update({ where: { id: interventionId }, data: { status: "IN_PROGRESS", startedAt: new Date() } });
    await recordAudit(tx, { actorId: actor.id, action: "intervention.start", entityType: "Intervention", entityId: interventionId });
  });
}

/** Rapport d'intervention (diagnostic, travaux, temps passé), modifiable tant qu'elle est en cours. */
export async function saveReport(client: PrismaClient, actor: Actor, interventionId: string, input: unknown): Promise<void> {
  await authorizeWork(client, actor, interventionId);
  const report = parseInput(reportSchema, input, "Rapport");
  await client.$transaction(async (tx) => {
    await lockForWork(tx, actor, interventionId, ["IN_PROGRESS"]);
    await tx.interventionReport.upsert({
      where: { interventionId },
      create: { interventionId, ...report, authorId: actor.id },
      update: { ...report, authorId: actor.id },
    });
    await recordAudit(tx, { actorId: actor.id, action: "intervention.report", entityType: "Intervention", entityId: interventionId, after: { timeSpentMin: report.timeSpentMin } });
  });
}

/**
 * Fin des travaux : rapport obligatoire, nom de la personne présente chez le client.
 * L'intervention devient encaissable (règlement en espèces après la prestation).
 */
export async function completeIntervention(client: PrismaClient, actor: Actor, interventionId: string, input: unknown): Promise<void> {
  await authorizeWork(client, actor, interventionId);
  const { customerSignOff } = parseInput(completeSchema, input, "Fin d'intervention");
  await client.$transaction(async (tx) => {
    const intervention = await lockForWork(tx, actor, interventionId, ["IN_PROGRESS"]);
    if (!(await tx.interventionReport.findUnique({ where: { interventionId }, select: { id: true } }))) {
      throw new AppError("CONFLICT", "Rédigez le rapport d'intervention avant de la terminer.");
    }
    await tx.intervention.update({ where: { id: interventionId }, data: { status: "DONE", completedAt: new Date(), customerSignOff } });
    await notifyCustomer(tx, intervention, "intervention.done", { total: intervention.amountDue - intervention.amountPaid });
    await recordAudit(tx, { actorId: actor.id, action: "intervention.complete", entityType: "Intervention", entityId: interventionId, after: { customerSignOff } });
  });
  await dispatchNotifications(client, { interventionId });
}

/**
 * Annulation motivée par le responsable, avant la fin des travaux. Le créneau est libéré et
 * les pièces du catalogue déjà sorties reviennent en stock (mouvement IN motivé).
 */
export async function cancelIntervention(client: PrismaClient, actor: Actor, interventionId: string, input: unknown): Promise<void> {
  await authorizeWork(client, actor, interventionId, "manage");
  const { reason } = parseInput(cancelSchema, input, "Annulation");
  await client.$transaction(async (tx) => {
    const intervention = await lockForWork(tx, actor, interventionId, ["TO_SCHEDULE", "SCHEDULED", "IN_PROGRESS"], "manage");
    await tx.appointment.deleteMany({ where: { interventionId } });
    const parts = await tx.interventionPart.findMany({ where: { interventionId, variantId: { not: null } }, select: { variantId: true, quantity: true } });
    for (const part of parts) {
      await applyStockMovement(tx, actor.id, {
        type: "IN",
        variantId: part.variantId!,
        quantity: part.quantity,
        reason: `Retour pièce, intervention ${intervention.number} annulée`,
      });
    }
    await tx.intervention.update({ where: { id: interventionId }, data: { status: "CANCELLED", cancelledAt: new Date(), cancelReason: reason } });
    await recordAudit(tx, {
      actorId: actor.id,
      action: "intervention.cancel",
      entityType: "Intervention",
      entityId: interventionId,
      before: { status: intervention.status },
      after: { reason, partsReturned: parts.length },
    });
  });
}
