import "server-only";
import type { InterventionStatus, Prisma } from "@/generated/prisma/client";
import { assertPermission, type Actor } from "@/server/authz/service";
import type { Db } from "@/server/db/client";
import { AppError } from "@/server/errors";
import { lockInterventionRow } from "@/server/modules/payments/targets";

type Tx = Prisma.TransactionClient;

/** Le technicien assigné peut travailler sur SON intervention (interventions.update_own). */
export const isAssignedTechnician = (actor: Actor, technicianUserId: string | null): boolean =>
  technicianUserId !== null && technicianUserId === actor.id && actor.permissions.has("interventions.update_own");

/**
 * Travail sur une intervention : le responsable (interventions.manage), ou le technicien
 * assigné. Sinon refus journalisé.
 */
export async function assertCanWork(client: Db, actor: Actor, technicianUserId: string | null): Promise<void> {
  if (actor.permissions.has("interventions.manage") || isAssignedTechnician(actor, technicianUserId)) return;
  await assertPermission(client, actor, "interventions.manage");
}

/** Consultation : interventions.read ou .manage, ou le technicien assigné. */
export async function assertCanRead(client: Db, actor: Actor, technicianUserId: string | null): Promise<void> {
  if (actor.permissions.has("interventions.manage") || isAssignedTechnician(actor, technicianUserId)) return;
  await assertPermission(client, actor, "interventions.read");
}

export interface LockedIntervention {
  id: string;
  number: string;
  status: InterventionStatus;
  amountDue: number;
  amountPaid: number;
  technicianUserId: string | null;
  contact: Prisma.JsonValue;
}

/**
 * Contrôle d'accès AVANT la transaction (le refus est journalisé et ne serait pas conservé
 * dans une transaction annulée). Revérifié ensuite sous verrou par lockForWork.
 */
export async function authorizeWork(client: Db, actor: Actor, interventionId: string, mode: "work" | "manage" = "work"): Promise<void> {
  if (mode === "manage") return assertPermission(client, actor, "interventions.manage");
  const row = await client.intervention.findUnique({ where: { id: interventionId }, select: { technician: { select: { userId: true } } } });
  if (!row) throw new AppError("NOT_FOUND", "Intervention introuvable.");
  await assertCanWork(client, actor, row.technician?.userId ?? null);
}

/**
 * Verrouille l'intervention (avant tout verrou de stock) puis revérifie, sous le verrou,
 * l'accès (le technicien a pu être changé entre-temps) et le statut attendu.
 */
export async function lockForWork(
  tx: Tx,
  actor: Actor,
  interventionId: string,
  allowed: readonly InterventionStatus[],
  mode: "work" | "manage" = "work",
): Promise<LockedIntervention> {
  await lockInterventionRow(tx, interventionId);
  const row = await tx.intervention.findUniqueOrThrow({
    where: { id: interventionId },
    select: { id: true, number: true, status: true, amountDue: true, amountPaid: true, contact: true, technician: { select: { userId: true } } },
  });
  const technicianUserId = row.technician?.userId ?? null;
  const manager = actor.permissions.has("interventions.manage");
  if (!(manager || (mode === "work" && isAssignedTechnician(actor, technicianUserId)))) {
    throw new AppError("FORBIDDEN", "Cette intervention ne vous est pas attribuée.");
  }
  if (!allowed.includes(row.status)) throw new AppError("CONFLICT", STATUS_REFUSAL[row.status]);
  return { id: row.id, number: row.number, status: row.status, amountDue: row.amountDue, amountPaid: row.amountPaid, technicianUserId, contact: row.contact };
}

const STATUS_REFUSAL: Record<InterventionStatus, string> = {
  TO_SCHEDULE: "Planifiez d'abord l'intervention.",
  SCHEDULED: "Démarrez d'abord l'intervention.",
  IN_PROGRESS: "L'intervention est en cours.",
  DONE: "L'intervention est terminée.",
  CANCELLED: "L'intervention est annulée.",
};
