/**
 * Messages affichés au retour d'une connexion sociale en échec (paramètre `error` posé par Better Auth).
 * Liste fermée : un code inconnu donne le message générique, et `error_description` (texte libre venu du
 * fournisseur ou de l'URL) n'est jamais affiché.
 */
const EXISTING_ACCOUNT = "Un compte existe déjà avec cette adresse e-mail. Connectez-vous avec votre e-mail et votre mot de passe.";
const EXPIRED = "La connexion a expiré. Réessayez.";
const GENERIC = "La connexion n'a pas abouti. Réessayez ou connectez-vous avec votre e-mail et votre mot de passe.";

const MESSAGES: ReadonlyMap<string, string> = new Map([
  ["account_not_linked", EXISTING_ACCOUNT],
  ["social_not_allowed", EXISTING_ACCOUNT],
  ["unable_to_link_account", EXISTING_ACCOUNT],
  ["access_denied", "Connexion annulée."],
  ["email_not_found", "Ce compte ne fournit pas d'adresse e-mail. Autorisez l'accès à votre e-mail ou créez un compte avec votre e-mail."],
  ["state_mismatch", EXPIRED],
  ["state_not_found", EXPIRED],
  ["state_invalid", EXPIRED],
  ["please_restart_the_process", EXPIRED],
  ["unable_to_create_session", "Ce compte ne peut pas se connecter. Contactez la boutique."],
]);

/** Message pour le paramètre `error` (chaîne, ou tableau si le paramètre est répété), sinon undefined. */
export function socialErrorMessage(code: unknown): string | undefined {
  if (Array.isArray(code)) return code.length > 0 ? GENERIC : undefined;
  if (typeof code !== "string" || code.length === 0) return undefined;
  return MESSAGES.get(code) ?? GENERIC;
}
