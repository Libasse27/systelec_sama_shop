import "server-only";
import type { PrismaClient } from "@/generated/prisma/client";
import { formatDateTime } from "@/lib/dates";
import { recordAudit } from "@/server/audit/audit";
import { logger } from "@/server/logger";
import { dispatchNotifications, queueNotifications } from "@/server/notifications/queue";
import { isProcessingOverdue, processingDueAt, RETURN_PROCESSING_BUSINESS_HOURS } from "./policy";
import { getBusinessHours } from "./queries";
import { recordReturnEvent } from "./service";
import { activeAdmins } from "./staff";

const BATCH = 500;

/**
 * Décision 2 : un retour sans aucune action du personnel 24 heures ouvrables après sa déclaration
 * déclenche UNE alerte aux administrateurs actifs (e-mail ; SMS tracé sans fournisseur). La demande
 * reste ouverte : elle n'est jamais annulée ni décidée automatiquement. Idempotent, même lancé deux
 * fois en parallèle (alerte posée sous le verrou du retour). Renvoie les numéros alertés.
 * À lancer par la tâche planifiée (pnpm orders:expire).
 */
export async function notifyOverdueReturns(client: PrismaClient, now: Date = new Date()): Promise<string[]> {
  const schedule = await getBusinessHours(client);
  const candidates = await client.return.findMany({
    where: { status: "RECEIVED", firstActionAt: null, overdueNotifiedAt: null },
    orderBy: { createdAt: "asc" },
    select: { id: true, createdAt: true, firstActionAt: true },
    take: BATCH,
  });
  const notified: string[] = [];
  for (const candidate of candidates.filter((entry) => isProcessingOverdue(entry, schedule, now))) {
    const number = await client.$transaction(async (tx) => {
      await tx.$queryRaw`SELECT id FROM returns WHERE id = ${candidate.id} FOR UPDATE`;
      const current = await tx.return.findUniqueOrThrow({
        where: { id: candidate.id },
        select: {
          number: true,
          status: true,
          createdAt: true,
          firstActionAt: true,
          overdueNotifiedAt: true,
          order: { select: { number: true, customer: { select: { name: true } } } },
        },
      });
      // Revérifié sous verrou : une action ou une alerte simultanée l'emporte.
      if (current.status !== "RECEIVED" || current.firstActionAt !== null || current.overdueNotifiedAt !== null) return null;
      // Destinataires lus AVANT de marquer l'alerte : sans destinataire joignable, rien n'est marqué
      // (l'alerte sera retentée au prochain passage) et l'anomalie est journalisée.
      const admins = await activeAdmins(tx);
      if (admins.length === 0) {
        logger.error("Retour en retard de traitement : aucun administrateur actif joignable, alerte reportée", { returnId: candidate.id });
        return null;
      }
      const dueAt = processingDueAt(current.createdAt, schedule);
      await tx.return.update({ where: { id: candidate.id }, data: { overdueNotifiedAt: now } });
      const comment = `Aucune action ${RETURN_PROCESSING_BUSINESS_HOURS} heures ouvrables après la déclaration (échéance : ${formatDateTime(dueAt)}). La demande reste ouverte.`;
      await recordReturnEvent(tx, candidate.id, { type: "OVERDUE_NOTIFIED", fromStatus: "RECEIVED", toStatus: "RECEIVED", actorId: null, comment, details: { dueAt: dueAt.toISOString() } });
      const message = {
        number: current.number,
        orderNumber: current.order.number,
        customerName: current.order.customer.name,
        declaredAt: formatDateTime(current.createdAt),
        dueAt: formatDateTime(dueAt),
      };
      for (const admin of admins) await queueNotifications(tx, { returnId: candidate.id }, "return.overdue_staff", message, { email: admin.email, phone: admin.phone });
      await recordAudit(tx, { actorId: null, action: "return.overdue", entityType: "Return", entityId: candidate.id, after: { dueAt, recipients: admins.length } });
      return current.number;
    });
    if (number) {
      notified.push(number);
      await dispatchNotifications(client, { returnId: candidate.id });
    }
  }
  return notified;
}
