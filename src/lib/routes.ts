/** Préfixe du back-office : toutes les pages du personnel vivent sous /admin. */
const ADMIN_PREFIX = "/admin";

/** Préfixes de l'espace FUTANI TECH : la rubrique Services et les devis de prestations. */
const TECH_PREFIXES = ["/services", "/devis"] as const;

/** Vrai pour le préfixe lui-même et ses sous-pages (jamais pour un nom qui commence pareil, ex. /admin-x). */
function isUnderPrefix(pathname: string, prefix: string): boolean {
  return pathname === prefix || pathname.startsWith(`${prefix}/`);
}

/** Vrai pour /admin et /admin/… (jamais pour /administration ou /admin-x). */
export function isAdminPath(pathname: string): boolean {
  return isUnderPrefix(pathname, ADMIN_PREFIX);
}

/** Vrai dans l'espace FUTANI TECH (/services/…, /devis/…) ; le reste du site public est FUTANI SHOP. */
export function isTechPath(pathname: string): boolean {
  return TECH_PREFIXES.some((prefix) => isUnderPrefix(pathname, prefix));
}
