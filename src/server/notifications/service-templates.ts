import { formatFcfa } from "@/lib/money";

/** Textes des notifications des services techniques (texte brut : e-mail et SMS). */
export type ServiceTemplate =
  | "quote_request.received"
  | "quote_request.new_staff"
  | "quote.sent"
  | "quote.decided_staff"
  | "intervention.scheduled"
  | "intervention.done"
  | "intervention.payment";

export interface ServiceMessageData {
  /** Numéro du document concerné (demande, devis ou intervention). */
  number: string;
  customerName: string;
  total?: number;
  /** Devis : date de fin de validité, déjà formatée. */
  validUntil?: string;
  /** Devis : accepté ou refusé. */
  accepted?: boolean;
  /** Intervention : créneau déjà formaté et technicien. */
  schedule?: string;
  technician?: string;
  payment?: { amount: number; balance: number; receiptNumber: string };
}

export const SERVICE_TEMPLATES: readonly ServiceTemplate[] = [
  "quote_request.received",
  "quote_request.new_staff",
  "quote.sent",
  "quote.decided_staff",
  "intervention.scheduled",
  "intervention.done",
  "intervention.payment",
];

const CASH_ONLY = "Règlement en espèces après la prestation : aucun paiement en ligne ne vous sera demandé.";

export function renderServiceMessage(template: ServiceTemplate, data: ServiceMessageData): { subject: string; text: string } {
  const hello = `Bonjour ${data.customerName},`;
  switch (template) {
    case "quote_request.received":
      return {
        subject: `Demande ${data.number} reçue`,
        text: [hello, `Nous avons bien reçu votre demande ${data.number}. Nous l'étudions et revenons vers vous rapidement.`, CASH_ONLY].join("\n\n"),
      };
    case "quote_request.new_staff":
      return { subject: `Nouvelle demande ${data.number}`, text: `Nouvelle demande de devis ${data.number} de ${data.customerName}, à étudier dans l'administration.` };
    case "quote.sent":
      return {
        subject: `Votre devis ${data.number}`,
        text: [
          hello,
          `Votre devis ${data.number} est prêt : ${formatFcfa(required(data.total, "total"))}, valable jusqu'au ${required(data.validUntil, "validité")}.`,
          "Vous pouvez l'accepter ou le refuser depuis votre lien de suivi ou votre compte, ou en nous appelant.",
          CASH_ONLY,
        ].join("\n\n"),
      };
    case "quote.decided_staff":
      return {
        subject: `Devis ${data.number} ${data.accepted ? "accepté" : "refusé"}`,
        text: `Le devis ${data.number} de ${data.customerName} a été ${data.accepted ? "accepté : une intervention est à planifier" : "refusé"}.`,
      };
    case "intervention.scheduled":
      return {
        subject: `Intervention ${data.number} planifiée`,
        text: [hello, `Votre intervention ${data.number} est planifiée le ${required(data.schedule, "créneau")}${data.technician ? ` avec ${data.technician}` : ""}.`, CASH_ONLY].join("\n\n"),
      };
    case "intervention.done":
      return {
        subject: `Intervention ${data.number} terminée`,
        text: [hello, `L'intervention ${data.number} est terminée. ${dueText(required(data.total, "total"))}`].join("\n\n"),
      };
    case "intervention.payment": {
      const payment = required(data.payment, "encaissement");
      return {
        subject: `Intervention ${data.number} : paiement reçu`,
        text: [
          hello,
          `Nous avons reçu ${formatFcfa(payment.amount)} en espèces pour l'intervention ${data.number} (reçu ${payment.receiptNumber}).`,
          payment.balance > 0 ? `Reste à payer : ${formatFcfa(payment.balance)}.` : "L'intervention est entièrement payée. Merci !",
        ].join("\n\n"),
      };
    }
  }
}

const dueText = (amount: number) => (amount > 0 ? `Montant à régler en espèces : ${formatFcfa(amount)}.` : "Aucun montant ne reste à régler. Merci !");

function required<T>(value: T | undefined, label: string): T {
  if (value === undefined) throw new Error(`Donnée de notification absente : ${label}`);
  return value;
}
