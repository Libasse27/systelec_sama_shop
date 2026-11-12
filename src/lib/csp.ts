/**
 * Content-Security-Policy des pages (posée par src/proxy.ts, nonce par requête). Module sans dépendance
 * serveur : le proxy ne lit pas la configuration (getServerEnv).
 */

/**
 * Origines des pages d'autorisation des fournisseurs de connexion sociale. Sans JavaScript, le formulaire
 * « Continuer avec… » est suivi d'une redirection 303 vers le fournisseur, soumise à form-action ;
 * Microsoft peut rebondir sur login.live.com (comptes personnels).
 */
export const OAUTH_FORM_ORIGINS = [
  "https://accounts.google.com",
  "https://www.facebook.com",
  "https://appleid.apple.com",
  "https://login.microsoftonline.com",
  "https://login.live.com",
] as const;

/** Seules ces pages affichent les boutons de connexion sociale. */
const SOCIAL_SIGN_IN_PATHS: readonly string[] = ["/connexion", "/inscription"];

function formAction(pathname: string): string {
  const origins = SOCIAL_SIGN_IN_PATHS.includes(pathname) ? ["'self'", ...OAUTH_FORM_ORIGINS] : ["'self'"];
  return `form-action ${origins.join(" ")}`;
}

export function contentSecurityPolicy(nonce: string, pathname: string, isDev: boolean): string {
  return [
    "default-src 'self'",
    `script-src 'self' 'nonce-${nonce}' 'strict-dynamic'${isDev ? " 'unsafe-eval'" : ""}`,
    "style-src 'self' 'unsafe-inline'",
    "img-src 'self' data: https:",
    "font-src 'self'",
    "connect-src 'self'",
    "object-src 'none'",
    "base-uri 'self'",
    formAction(pathname),
    "frame-ancestors 'none'",
  ].join("; ");
}
