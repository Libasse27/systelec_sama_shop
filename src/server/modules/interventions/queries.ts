import "server-only";
import type { InterventionStatus, PaymentStatus, Prisma } from "@/generated/prisma/client";
import { assertPermission, type Actor } from "@/server/authz/service";
import type { Db } from "@/server/db/client";
import { AppError } from "@/server/errors";
import type { Contact } from "@/server/modules/orders/schemas";
import { assertCanRead, isAssignedTechnician } from "./access";

export const ADMIN_INTERVENTIONS_PAGE_SIZE = 30;

const STATUSES: readonly InterventionStatus[] = ["TO_SCHEDULE", "SCHEDULED", "IN_PROGRESS", "DONE", "CANCELLED"];

export function parseInterventionStatus(value: unknown): InterventionStatus | undefined {
  return STATUSES.find((status) => status === value);
}

/** Le personnel avec interventions.read/.manage voit tout ; un technicien, seulement ce qui lui est attribué. */
async function visibilityFilter(client: Db, actor: Actor): Promise<Prisma.InterventionWhereInput> {
  if (actor.permissions.has("interventions.read") || actor.permissions.has("interventions.manage")) return {};
  if (actor.permissions.has("interventions.update_own")) return { technician: { userId: actor.id } };
  await assertPermission(client, actor, "interventions.read");
  return {};
}

export interface AdminInterventionRow {
  id: string;
  number: string;
  status: InterventionStatus;
  paymentStatus: PaymentStatus;
  amountDue: number;
  customerName: string;
  address: string;
  technician: string | null;
  nextAppointment: Date | null;
  createdAt: Date;
}

export async function listAdminInterventions(
  client: Db,
  actor: Actor,
  options: { status?: InterventionStatus; page?: number } = {},
): Promise<{ rows: AdminInterventionRow[]; total: number; page: number; pageCount: number }> {
  const where: Prisma.InterventionWhereInput = { ...(await visibilityFilter(client, actor)), ...(options.status ? { status: options.status } : {}) };
  const total = await client.intervention.count({ where });
  const pageCount = Math.max(1, Math.ceil(total / ADMIN_INTERVENTIONS_PAGE_SIZE));
  const page = Math.min(Math.max(1, Math.trunc(options.page ?? 1)), pageCount);
  const rows = await client.intervention.findMany({
    where,
    orderBy: [{ createdAt: "desc" }, { id: "desc" }],
    skip: (page - 1) * ADMIN_INTERVENTIONS_PAGE_SIZE,
    take: ADMIN_INTERVENTIONS_PAGE_SIZE,
    select: {
      id: true,
      number: true,
      status: true,
      paymentStatus: true,
      amountDue: true,
      address: true,
      createdAt: true,
      customer: { select: { name: true } },
      technician: { select: { user: { select: { name: true } } } },
      appointments: { orderBy: { startsAt: "asc" }, take: 1, select: { startsAt: true } },
    },
  });
  return {
    rows: rows.map(({ customer, technician, appointments, ...row }) => ({
      ...row,
      customerName: customer.name,
      technician: technician?.user.name ?? null,
      nextAppointment: appointments[0]?.startsAt ?? null,
    })),
    total,
    page,
    pageCount,
  };
}

/** Fiche d'intervention pour le personnel. Le coût interne des pièces n'est montré qu'aux responsables. */
export async function getAdminIntervention(client: Db, actor: Actor, id: string) {
  const row = await client.intervention.findUnique({
    where: { id },
    select: {
      id: true,
      number: true,
      status: true,
      paymentStatus: true,
      amountDue: true,
      amountPaid: true,
      contact: true,
      address: true,
      problem: true,
      customerSignOff: true,
      cancelReason: true,
      startedAt: true,
      completedAt: true,
      createdAt: true,
      service: { select: { name: true } },
      quote: { select: { id: true, number: true } },
      quoteRequest: { select: { id: true, number: true, availability: true, urgency: true } },
      technician: { select: { id: true, userId: true, user: { select: { name: true } } } },
      appointments: { orderBy: { startsAt: "asc" }, select: { startsAt: true, endsAt: true } },
      report: { select: { diagnosis: true, workDone: true, timeSpentMin: true, observations: true, updatedAt: true } },
      parts: { orderBy: { createdAt: "asc" }, select: { id: true, label: true, quantity: true, unitCost: true, variant: { select: { sku: true } } } },
      invoice: { select: { number: true, issuedAt: true } },
    },
  });
  if (!row) return null;
  await assertCanRead(client, actor, row.technician?.userId ?? null);
  const manager = actor.permissions.has("interventions.manage");
  const parts = row.parts.map(({ variant, unitCost, ...part }) => ({ ...part, sku: variant?.sku ?? null, unitCost: manager ? unitCost : null }));
  return {
    ...row,
    contact: row.contact as unknown as Contact,
    parts,
    internalCost: manager ? parts.reduce((sum, part) => sum + (part.unitCost ?? 0) * part.quantity, 0) : null,
    canManage: manager,
    canWork: manager || isAssignedTechnician(actor, row.technician?.userId ?? null),
  };
}

export type AdminIntervention = NonNullable<Awaited<ReturnType<typeof getAdminIntervention>>>;

/** Durée maximale d'une fenêtre de planning consultée. */
export const MAX_PLANNING_DAYS = 31;

export interface PlanningSlot {
  startsAt: Date;
  endsAt: Date;
  technician: string;
  interventionId: string;
  interventionNumber: string;
  status: InterventionStatus;
  customerName: string;
  address: string;
}

/** Créneaux d'une période (tous, ou ceux du technicien connecté), triés par début. */
export async function getPlanning(client: Db, actor: Actor, range: { from: Date; to: Date }): Promise<PlanningSlot[]> {
  if (range.to.getTime() - range.from.getTime() > MAX_PLANNING_DAYS * 24 * 3600 * 1000) throw new AppError("VALIDATION", "Période trop longue.");
  const visibility = await visibilityFilter(client, actor);
  const slots = await client.appointment.findMany({
    where: { startsAt: { lt: range.to }, endsAt: { gt: range.from }, intervention: visibility },
    orderBy: [{ startsAt: "asc" }, { id: "asc" }],
    take: 1000,
    select: {
      startsAt: true,
      endsAt: true,
      technician: { select: { user: { select: { name: true } } } },
      intervention: { select: { id: true, number: true, status: true, address: true, customer: { select: { name: true } } } },
    },
  });
  return slots.map((slot) => ({
    startsAt: slot.startsAt,
    endsAt: slot.endsAt,
    technician: slot.technician.user.name,
    interventionId: slot.intervention.id,
    interventionNumber: slot.intervention.number,
    status: slot.intervention.status,
    customerName: slot.intervention.customer.name,
    address: slot.intervention.address,
  }));
}
