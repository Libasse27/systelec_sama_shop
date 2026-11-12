import type { BetterAuthOptions } from "better-auth";
import type { ServerEnv } from "@/lib/env";
import { isJwtUnexpired } from "@/lib/jwt-expiry";

/** Fournisseurs de connexion sociale pris en charge, dans l'ordre d'affichage. */
export const SOCIAL_PROVIDER_IDS = ["google", "facebook", "apple", "microsoft"] as const;
export type SocialProviderId = (typeof SOCIAL_PROVIDER_IDS)[number];

export const SOCIAL_PROVIDER_LABELS: Readonly<Record<SocialProviderId, string>> = {
  google: "Google",
  facebook: "Facebook",
  apple: "Apple",
  microsoft: "Microsoft",
};

/**
 * Hôtes des pages d'autorisation (redirection après le clic). Toute URL renvoyée par Better Auth hors de
 * ces hôtes est refusée. Les mêmes origines sont autorisées en form-action par la CSP (src/lib/csp.ts).
 */
export const PROVIDER_AUTHORIZATION_HOSTS: Readonly<Record<SocialProviderId, readonly string[]>> = {
  google: ["accounts.google.com"],
  facebook: ["www.facebook.com"],
  apple: ["appleid.apple.com"],
  microsoft: ["login.microsoftonline.com"],
};

export type SocialEnv = Partial<
  Pick<
    ServerEnv,
    | "GOOGLE_CLIENT_ID"
    | "GOOGLE_CLIENT_SECRET"
    | "FACEBOOK_CLIENT_ID"
    | "FACEBOOK_CLIENT_SECRET"
    | "APPLE_CLIENT_ID"
    | "APPLE_CLIENT_SECRET"
    | "MICROSOFT_CLIENT_ID"
    | "MICROSOFT_CLIENT_SECRET"
  >
> &
  Pick<ServerEnv, "MICROSOFT_TENANT_ID">;

interface Credentials {
  clientId: string;
  clientSecret: string;
}

function configuredCredentials(env: SocialEnv, provider: SocialProviderId): Credentials | null {
  const pairs: Record<SocialProviderId, [string | undefined, string | undefined]> = {
    google: [env.GOOGLE_CLIENT_ID, env.GOOGLE_CLIENT_SECRET],
    facebook: [env.FACEBOOK_CLIENT_ID, env.FACEBOOK_CLIENT_SECRET],
    apple: [env.APPLE_CLIENT_ID, env.APPLE_CLIENT_SECRET],
    microsoft: [env.MICROSOFT_CLIENT_ID, env.MICROSOFT_CLIENT_SECRET],
  };
  const [clientId, clientSecret] = pairs[provider];
  return clientId && clientSecret ? { clientId, clientSecret } : null;
}

/**
 * Identifiants utilisables : paire complète et, pour Apple, secret JWT pas encore expiré. Un secret Apple
 * expiré désactive Apple seul (pas de bouton, retour en 404) au lieu d'empêcher la boutique de démarrer.
 */
function credentialsOf(env: SocialEnv, provider: SocialProviderId, nowMs: number): Credentials | null {
  const credentials = configuredCredentials(env, provider);
  if (provider === "apple" && credentials && !isJwtUnexpired(credentials.clientSecret, nowMs)) return null;
  return credentials;
}

/** Apple configuré mais inutilisable (secret expiré ou illisible) : à signaler dans le journal. */
export function isAppleSecretExpired(env: SocialEnv, nowMs: number = Date.now()): boolean {
  return configuredCredentials(env, "apple") !== null && credentialsOf(env, "apple", nowMs) === null;
}

export function isSocialProviderId(value: unknown): value is SocialProviderId {
  return typeof value === "string" && (SOCIAL_PROVIDER_IDS as readonly string[]).includes(value);
}

/** Fournisseurs actifs : identifiant ET secret configurés (secret Apple non expiré). */
export function enabledSocialProviders(env: SocialEnv, nowMs: number = Date.now()): readonly SocialProviderId[] {
  return SOCIAL_PROVIDER_IDS.filter((provider) => credentialsOf(env, provider, nowMs) !== null);
}

type SocialProvidersConfig = NonNullable<BetterAuthOptions["socialProviders"]>;

/**
 * Configuration Better Auth des fournisseurs actifs. Minimisation : portées par défaut (Microsoft réduit
 * à openid/profile/email), aucune connexion directe par jeton d'identité, pas de photo de profil Microsoft,
 * aucun mappage de profil supplémentaire.
 */
export function buildSocialProviders(env: SocialEnv, nowMs: number = Date.now()): SocialProvidersConfig {
  const google = credentialsOf(env, "google", nowMs);
  const facebook = credentialsOf(env, "facebook", nowMs);
  const apple = credentialsOf(env, "apple", nowMs);
  const microsoft = credentialsOf(env, "microsoft", nowMs);
  return {
    ...(google && { google: { ...google, disableIdTokenSignIn: true } }),
    ...(facebook && { facebook: { ...facebook, disableIdTokenSignIn: true } }),
    ...(apple && { apple: { ...apple, disableIdTokenSignIn: true } }),
    ...(microsoft && {
      microsoft: {
        ...microsoft,
        tenantId: env.MICROSOFT_TENANT_ID,
        disableProfilePhoto: true,
        disableDefaultScope: true,
        scope: ["openid", "profile", "email"],
        disableIdTokenSignIn: true,
      },
    }),
  };
}

/**
 * Seule route HTTP Better Auth exposée : le retour du fournisseur. GET pour tout fournisseur actif ;
 * POST uniquement pour Apple, qui renvoie la réponse par formulaire (response_mode=form_post).
 */
export function isAllowedOAuthCallback(provider: string, method: string, enabled: readonly SocialProviderId[]): boolean {
  if (!isSocialProviderId(provider) || !enabled.includes(provider)) return false;
  if (method === "GET") return true;
  return method === "POST" && provider === "apple";
}

/** L'URL d'autorisation renvoyée par Better Auth pointe-t-elle bien chez le fournisseur attendu (https) ? */
export function isExpectedAuthorizationURL(provider: SocialProviderId, url: string): boolean {
  try {
    const parsed = new URL(url);
    return parsed.protocol === "https:" && PROVIDER_AUTHORIZATION_HOSTS[provider].includes(parsed.hostname);
  } catch {
    return false;
  }
}
