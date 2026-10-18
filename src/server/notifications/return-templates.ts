/** Alertes internes sur les retours (texte brut : e-mail et SMS), destinées aux administrateurs. */
export type ReturnTemplate = "return.overdue_staff";

export const RETURN_TEMPLATES: readonly ReturnTemplate[] = ["return.overdue_staff"];

export interface ReturnMessageData {
  /** Numéro du retour. */
  number: string;
  orderNumber: string;
  customerName: string;
  /** Dates déjà formatées (Dakar). */
  declaredAt: string;
  dueAt: string;
}

export function renderReturnMessage(template: ReturnTemplate, data: ReturnMessageData): { subject: string; text: string } {
  switch (template) {
    case "return.overdue_staff":
      return {
        subject: `Retour ${data.number} : délai de traitement dépassé`,
        text: [
          `Le retour ${data.number} (commande ${data.orderNumber}, client ${data.customerName}), déclaré le ${data.declaredAt}, n'a reçu aucune action avant l'échéance du ${data.dueAt} (24 heures ouvrables).`,
          "La demande reste ouverte : examinez-la dans l'administration (Retours).",
        ].join("\n\n"),
      };
  }
}
