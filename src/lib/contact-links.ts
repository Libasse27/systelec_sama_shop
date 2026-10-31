/** Liens de contact partagés (pied de page, page Contact) : même normalisation partout. */

/** Numéro composable : chiffres et « + » seulement (espaces et tirets de l'affichage retirés). */
export function telHref(phone: string): string {
  return `tel:${phone.replace(/[^+\d]/g, "")}`;
}

/** Lien WhatsApp (wa.me attend les chiffres seuls) ; null si le numéro n'en contient aucun. */
export function whatsappHref(phone: string): string | null {
  const digits = phone.replace(/\D/g, "");
  return digits ? `https://wa.me/${digits}` : null;
}
