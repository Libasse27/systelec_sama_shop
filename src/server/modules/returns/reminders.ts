import "server-only";
import type { PrismaClient } from "@/generated/prisma/client";
import { addBusinessHours, type BusinessHours } from "@/lib/business-hours";
import { formatDateTime } from "@/lib/dates";
import { RETURN_VERIFICATION_KIND_LABELS } from "@/lib/labels";
import { recordAudit } from "@/server/audit/audit";
import type { Db } from "@/server/db/client";
import { logger } from "@/server/logger";
import type { Contact } from "@/server/modules/orders/schemas";
import { settingsDefaults, type SettingValue } from "@/server/modules/settings/schemas";
import { getSetting } from "@/server/modules/settings/service";
import { dispatchNotifications, queueNotifications } from "@/server/notifications/queue";
import type { ReturnMessageData } from "@/server/notifications/return-templates";
import { customerConcernedBy } from "./policy";
import { getBusinessHours } from "./queries";
import { recordReturnEvent } from "./service";
import { activeAdmins } from "./staff";

type Reminders = SettingValue<"returnReminders">;

/** Paliers de relance d'une vérification sans réponse : 1 et 2 = relances, 3 = escalade aux administrateurs. */
export const ESCALATION_STAGE = 3;
const BATCH = 500;

/** Délais de relance en vigueur ; une valeur illisible ne bloque pas la tâche planifiée (repli journalisé). */
export async function getReturnReminders(client: Db): Promise<Reminders> {
  try {
    return await getSetting("returnReminders", client);
  } catch (error) {
    logger.error("Délais de relance illisibles : valeurs par défaut utilisées", { error: error instanceof Error ? error.message : "inconnue" });
    return settingsDefaults.returnReminders;
  }
}

/** Échéances des paliers 1, 2 et 3 d'une vérification demandée à `requestedAt`. */
export function reminderDueDates(requestedAt: Date, reminders: Reminders, schedule: BusinessHours): [Date, Date, Date] {
  return [
    addBusinessHours(requestedAt, reminders.firstReminderHours, schedule),
    addBusinessHours(requestedAt, reminders.secondReminderHours, schedule),
    addBusinessHours(requestedAt, reminders.escalationHours, schedule),
  ];
}

/**
 * Palier atteint à `now` (0 à 3). Une tâche planifiée lancée en retard passe directement au palier le
 * plus élevé atteint : les relances intermédiaires dépassées ne sont pas envoyées en rafale.
 */
export function reminderStageAt(requestedAt: Date, reminders: Reminders, schedule: BusinessHours, now: Date): number {
  return reminderDueDates(requestedAt, reminders, schedule).filter((due) => now.getTime() > due.getTime()).length;
}

const hoursOfStage = (stage: number, reminders: Reminders): number =>
  [reminders.firstReminderHours, reminders.secondReminderHours, reminders.escalationHours][stage - 1] ?? reminders.escalationHours;

export interface SentReminder {
  number: string;
  stage: number;
}

/**
 * Décision 4 (phase 10) : relance les vérifications restées sans réponse, en heures ouvrables depuis la
 * demande (paramètre « returnReminders », 12 / 24 / 48 h par défaut) :
 * - paliers 1 et 2 : rappel au client (s'il est concerné et joignable) et alerte au responsable qui a
 *   demandé la vérification (aux administrateurs s'il n'est plus joignable) ;
 * - palier 3 : escalade aux administrateurs actifs.
 * Chaque palier n'est envoyé qu'une fois (posé sous le verrou du retour, croissant en base) et inscrit à
 * l'historique ; tout s'arrête dès la réponse (la base remet le suivi à zéro). La demande n'est jamais
 * annulée. Sans destinataire interne joignable, rien n'est marqué : retenté au passage suivant.
 * Notifications internes : le tableau de bord ; e-mails envoyés seulement si le service est configuré.
 * À lancer par la tâche planifiée (pnpm orders:expire). Renvoie les relances envoyées.
 */
export async function remindPendingVerifications(client: PrismaClient, now: Date = new Date()): Promise<SentReminder[]> {
  const [schedule, reminders] = await Promise.all([getBusinessHours(client), getReturnReminders(client)]);
  const candidates = await client.return.findMany({
    where: { status: "VERIFICATION", verificationReminderStage: { lt: ESCALATION_STAGE } },
    orderBy: { verificationRequestedAt: "asc" },
    select: { id: true, verificationRequestedAt: true, verificationReminderStage: true },
    take: BATCH,
  });
  const sent: SentReminder[] = [];
  for (const candidate of candidates) {
    if (!candidate.verificationRequestedAt) continue;
    const stage = reminderStageAt(candidate.verificationRequestedAt, reminders, schedule, now);
    if (stage <= candidate.verificationReminderStage) continue;
    const result = await sendReminder(client, candidate.id, stage, reminders);
    if (result) {
      sent.push(result);
      await dispatchNotifications(client, { returnId: candidate.id });
    }
  }
  return sent;
}

async function sendReminder(client: PrismaClient, returnId: string, stage: number, reminders: Reminders): Promise<SentReminder | null> {
  return client.$transaction(async (tx) => {
    await tx.$queryRaw`SELECT id FROM returns WHERE id = ${returnId} FOR UPDATE`;
    const current = await tx.return.findUniqueOrThrow({
      where: { id: returnId },
      select: {
        number: true,
        status: true,
        verificationRequestedAt: true,
        verificationReminderStage: true,
        order: { select: { number: true, contact: true } },
        events: { where: { type: "VERIFICATION_REQUESTED" }, orderBy: [{ createdAt: "desc" }, { id: "desc" }], take: 1, select: { actorId: true, comment: true, verificationKind: true } },
      },
    });
    // Revérifié sous verrou : une réponse ou une relance simultanée l'emporte.
    const request = current.events[0];
    if (current.status !== "VERIFICATION" || !current.verificationRequestedAt || current.verificationReminderStage >= stage || !request?.verificationKind) return null;

    const requester =
      stage < ESCALATION_STAGE && request.actorId ? await tx.user.findFirst({ where: { id: request.actorId, isActive: true }, select: { email: true, phone: true } }) : null;
    const staff = requester ? [requester] : await activeAdmins(tx);
    if (staff.length === 0) {
      logger.error("Vérification sans réponse : aucun membre du personnel joignable, relance reportée", { returnId, stage });
      return null;
    }

    const contact = current.order.contact as unknown as Contact;
    const kind = request.verificationKind;
    const message: ReturnMessageData = {
      number: current.number,
      orderNumber: current.order.number,
      customerName: contact.name,
      verificationKind: RETURN_VERIFICATION_KIND_LABELS[kind],
      request: request.comment ?? "",
      requestedAt: formatDateTime(current.verificationRequestedAt),
      reminder: stage,
      hours: hoursOfStage(stage, reminders),
      // Tâche lancée en retard : les relances intermédiaires n'ont peut-être pas été envoyées.
      previousReminders: current.verificationReminderStage,
    };
    const remindCustomer = stage < ESCALATION_STAGE && customerConcernedBy(kind) && Boolean(contact.email);

    await tx.return.update({ where: { id: returnId }, data: { verificationReminderStage: stage } });
    const escalated = stage === ESCALATION_STAGE;
    const comment = escalated
      ? `Aucune réponse ${message.hours} heures ouvrables après la demande : administrateurs alertés. La demande reste ouverte.`
      : `Relance n° ${stage} : aucune réponse ${message.hours} heures ouvrables après la demande${remindCustomer ? " (client et responsable relancés)" : " (responsable relancé)"}.`;
    await recordReturnEvent(tx, returnId, {
      type: escalated ? "VERIFICATION_ESCALATED" : "VERIFICATION_REMINDED",
      fromStatus: "VERIFICATION",
      toStatus: "VERIFICATION",
      actorId: null,
      comment,
      details: { stage, hours: message.hours, staffRecipients: staff.length, customerReminded: remindCustomer },
    });
    const staffTemplate = escalated ? "return.verification_escalated_staff" : "return.verification_reminder_staff";
    for (const member of staff) await queueNotifications(tx, { returnId }, staffTemplate, message, { email: member.email, phone: member.phone });
    if (remindCustomer) await queueNotifications(tx, { returnId }, "return.verification_customer", message, { email: contact.email ?? null, phone: null });
    await recordAudit(tx, {
      actorId: null,
      action: escalated ? "return.verification.escalate" : "return.verification.remind",
      entityType: "Return",
      entityId: returnId,
      after: { stage, hours: message.hours, staffRecipients: staff.length, customerReminded: remindCustomer },
    });
    return { number: current.number, stage };
  });
}
