/**
 * Adresse de la page d'une famille de services. Le segment « categorie » évite tout conflit avec
 * les fiches /services/[slug] : aucune prestation ne doit donc porter le slug « categorie ».
 */
export function serviceFamilyPath(slug: string): string {
  return `/services/categorie/${slug}`;
}

/** Demande de devis préremplie pour une prestation. */
export function serviceQuotePath(serviceSlug: string): string {
  return `/devis/demande?service=${serviceSlug}`;
}
