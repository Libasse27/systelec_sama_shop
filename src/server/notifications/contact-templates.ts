/**
 * Textes des notifications du formulaire de contact (texte brut).
 * Aucune donnée saisie par le visiteur n'y figure : l'accusé part vers une adresse non vérifiée, et un
 * nom ou un domaine recopié y deviendrait un lien cliquable sous la marque. Seuls le numéro (généré) et
 * le libellé du sujet (liste fermée) sont utilisés ; le personnel lit le reste dans l'administration.
 */
export type ContactTemplate = "contact.received" | "contact.new_staff";

export const CONTACT_TEMPLATES: readonly ContactTemplate[] = ["contact.received", "contact.new_staff"];

export interface ContactMessageData {
  /** Numéro du message (MSG-…). */
  number: string;
  /** Libellé du sujet choisi. */
  subject: string;
}

export function renderContactMessage(template: ContactTemplate, data: ContactMessageData): { subject: string; text: string } {
  switch (template) {
    case "contact.received":
      return {
        subject: `Message ${data.number} bien reçu`,
        text:
          `Bonjour,\n\nNous avons bien reçu votre message (${data.subject}), enregistré sous le numéro ${data.number}. ` +
          "Notre équipe vous répond dans les meilleurs délais, par e-mail ou par téléphone.\n\n" +
          "Pour une commande, un devis ou un retour, rappelez ce numéro dans vos échanges.",
      };
    case "contact.new_staff":
      return {
        subject: `Nouveau message ${data.number} : ${data.subject}`,
        text: `Nouveau message ${data.number} (${data.subject}). À traiter dans l'administration, rubrique Messages.`,
      };
  }
}
