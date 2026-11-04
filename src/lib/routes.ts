/** Préfixe du back-office : toutes les pages du personnel vivent sous /admin. */
const ADMIN_PREFIX = "/admin";

/** Vrai pour /admin et /admin/… (jamais pour /administration ou /admin-x). */
export function isAdminPath(pathname: string): boolean {
  return pathname === ADMIN_PREFIX || pathname.startsWith(`${ADMIN_PREFIX}/`);
}
