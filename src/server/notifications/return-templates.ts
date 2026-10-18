/**
 * Messages sur les retours (texte brut : e-mail et SMS) : alertes internes au personnel et, depuis la
 * phase 10, suivi de la demande pour le client (accusé de réception, vérification demandée et
 * relances, décision).
 */
export type ReturnTemplate =
  | "return.overdue_staff"
  | "return.verification_reminder_staff"
  | "return.verification_escalated_staff"
  | "return.declared_customer"
  | "return.verification_customer"
  | "return.decided_customer";

export const RETURN_TEMPLATES: readonly ReturnTemplate[] = [
  "return.overdue_staff",
  "return.verification_reminder_staff",
  "return.verification_escalated_staff",
  "return.declared_customer",
  "return.verification_customer",
  "return.decided_customer",
];

export interface ReturnMessageData {
  /** Numéro du retour. */
  number: string;
  orderNumber: string;
  customerName: string;
  /** Dates déjà formatées (Dakar). */
  declaredAt?: string;
  dueAt?: string;
  /** Vérification : nature (libellé), demande précise, date de la demande ; relance n° 1 ou 2 (0 : la demande elle-même). */
  verificationKind?: string;
  request?: string;
  requestedAt?: string;
  reminder?: number;
  /** Heures ouvrables écoulées depuis la demande (relances, escalade). */
  hours?: number;
  /** Relances déjà envoyées avant cette escalade (0 si la tâche planifiée a été lancée en retard). */
  previousReminders?: number;
  /** Décision communiquée au client. */
  decision?: "ACCEPTED" | "REJECTED";
  decisionNote?: string;
  /** Montant à rembourser, déjà formaté. */
  refundAmount?: string;
  lateDeclaration?: boolean;
}

const CUSTOMER_FOOTER = "Suivez votre demande depuis votre compte (Mes commandes) ou votre lien de suivi personnel.";

function staffMessage(template: ReturnTemplate, data: ReturnMessageData): { subject: string; text: string } | null {
  const reference = `Le retour ${data.number} (commande ${data.orderNumber}, client ${data.customerName})`;
  switch (template) {
    case "return.overdue_staff":
      return {
        subject: `Retour ${data.number} : délai de traitement dépassé`,
        text: [
          `${reference}, déclaré le ${data.declaredAt}, n'a reçu aucune action avant l'échéance du ${data.dueAt} (24 heures ouvrables).`,
          "La demande reste ouverte : examinez-la dans l'administration (Retours).",
        ].join("\n\n"),
      };
    case "return.verification_reminder_staff":
      return {
        subject: `Retour ${data.number} : vérification sans réponse (relance ${data.reminder})`,
        text: [
          `${reference} attend depuis ${data.hours} heures ouvrables la réponse à la vérification demandée le ${data.requestedAt} (${data.verificationKind} : ${data.request}).`,
          "Relancez le client ou enregistrez la réponse dans l'administration (fiche du retour). La demande reste ouverte.",
        ].join("\n\n"),
      };
    case "return.verification_escalated_staff":
      return {
        subject: `Retour ${data.number} : vérification sans réponse, escalade`,
        text: [
          `${reference} attend depuis ${data.hours} heures ouvrables la réponse à la vérification demandée le ${data.requestedAt} (${data.verificationKind} : ${data.request})${data.previousReminders ? `, malgré ${data.previousReminders === 1 ? "une relance" : `${data.previousReminders} relances`}` : ""}.`,
          "La demande reste ouverte : décidez de la suite dans l'administration (Retours).",
        ].join("\n\n"),
      };
    default:
      return null;
  }
}

function customerMessage(template: ReturnTemplate, data: ReturnMessageData): { subject: string; text: string } {
  const greeting = `Bonjour ${data.customerName},`;
  switch (template) {
    case "return.declared_customer":
      return {
        subject: `Demande de retour ${data.number} reçue`,
        text: [
          greeting,
          `Nous avons bien reçu votre demande de retour ${data.number} pour la commande ${data.orderNumber}. Notre équipe l'examine ; aucun remboursement n'est automatique.`,
          data.lateDeclaration
            ? "Votre demande a été faite après le délai commercial de 48 heures : elle sera tout de même examinée (garantie, défaut caché, droits légaux)."
            : "",
          CUSTOMER_FOOTER,
        ]
          .filter(Boolean)
          .join("\n\n"),
      };
    case "return.verification_customer":
      return {
        subject: data.reminder ? `Rappel : informations attendues pour votre retour ${data.number}` : `Retour ${data.number} : informations demandées`,
        text: [
          greeting,
          `${data.reminder ? "Nous attendons toujours" : "Pour examiner votre demande de retour " + data.number + ", nous avons besoin"} de : ${data.verificationKind} — ${data.request}.`,
          "Répondez depuis votre compte (Mes commandes) ou votre lien de suivi personnel, en joignant si besoin des photos. Vous pouvez aussi nous contacter ou passer en boutique.",
        ].join("\n\n"),
      };
    case "return.decided_customer":
      return {
        subject: `Retour ${data.number} : ${data.decision === "ACCEPTED" ? "demande acceptée" : "demande refusée"}`,
        text: [
          greeting,
          data.decision === "ACCEPTED"
            ? `Votre demande de retour ${data.number} (commande ${data.orderNumber}) est acceptée.${data.refundAmount ? ` Remboursement prévu : ${data.refundAmount}, versé en espèces à la boutique.` : ""}`
            : `Votre demande de retour ${data.number} (commande ${data.orderNumber}) n'a pas été acceptée.`,
          data.decisionNote ? `Motif : ${data.decisionNote}` : "",
          CUSTOMER_FOOTER,
        ]
          .filter(Boolean)
          .join("\n\n"),
      };
    default:
      throw new Error(`Modèle de retour inconnu : ${template}`);
  }
}

export function renderReturnMessage(template: ReturnTemplate, data: ReturnMessageData): { subject: string; text: string } {
  return staffMessage(template, data) ?? customerMessage(template, data);
}
