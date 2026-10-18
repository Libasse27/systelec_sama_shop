import { addBusinessHours, type BusinessHours } from "@/lib/business-hours";

/**
 * Politique de retours (décision 2 du propriétaire), voir docs/03-plan-et-decisions.md.
 *
 * Délai COMMERCIAL de déclaration : 48 h après la remise au client (livraison effectuée ou retrait
 * en boutique). Il ne limite pas les droits légaux du client : une déclaration tardive est
 * enregistrée, marquée « hors délai », et peut être acceptée à titre d'exception motivée.
 * Le même délai est calculé par la base (trigger returns_check_insert, contrainte returns_declaration_check).
 */
export const RETURN_DECLARATION_HOURS = 48;

/** Délai pour commencer le traitement (première action du personnel), en heures ouvrables. */
export const RETURN_PROCESSING_BUSINESS_HOURS = 24;

/** Statuts d'un retour encore ouvert (rien n'est encore décidé). Un retour n'est jamais clos automatiquement. */
export const OPEN_RETURN_STATUSES = ["RECEIVED", "VERIFICATION"] as const;

/** Échéance du délai de traitement d'un retour enregistré à `declaredAt`. */
export function processingDueAt(declaredAt: Date, schedule: BusinessHours): Date {
  return addBusinessHours(declaredAt, RETURN_PROCESSING_BUSINESS_HOURS, schedule);
}

/** Vrai si aucune action n'a été faite sur le retour à son échéance de traitement. */
export function isProcessingOverdue(entry: { createdAt: Date; firstActionAt: Date | null }, schedule: BusinessHours, now: Date = new Date()): boolean {
  return entry.firstActionAt === null && now.getTime() > processingDueAt(entry.createdAt, schedule).getTime();
}
