import { describe, expect, it } from "vitest";
import { OAUTH_FORM_ORIGINS } from "@/lib/csp";
import {
  buildSocialProviders,
  enabledSocialProviders,
  isAllowedOAuthCallback,
  isAppleSecretExpired,
  isExpectedAuthorizationURL,
  PROVIDER_AUTHORIZATION_HOSTS,
  SOCIAL_PROVIDER_IDS,
  SOCIAL_PROVIDER_LABELS,
  type SocialEnv,
} from "./social-providers";

const base64url = (value: object) => Buffer.from(JSON.stringify(value)).toString("base64url");
const appleSecret = (expSeconds: number) => `${base64url({ alg: "ES256" })}.${base64url({ exp: expSeconds })}.signature`;
const NOW = Date.UTC(2026, 10, 12);
const validApple = appleSecret(NOW / 1000 + 90 * 24 * 3600);
const expiredApple = appleSecret(NOW / 1000 - 60);

const none: SocialEnv = { MICROSOFT_TENANT_ID: "consumers" };
const all: SocialEnv = {
  GOOGLE_CLIENT_ID: "g-id",
  GOOGLE_CLIENT_SECRET: "g-secret",
  FACEBOOK_CLIENT_ID: "f-id",
  FACEBOOK_CLIENT_SECRET: "f-secret",
  APPLE_CLIENT_ID: "a-id",
  APPLE_CLIENT_SECRET: validApple,
  MICROSOFT_CLIENT_ID: "m-id",
  MICROSOFT_CLIENT_SECRET: "m-secret",
  MICROSOFT_TENANT_ID: "consumers",
};

describe("fournisseurs de connexion sociale", () => {
  it("aucun fournisseur sans identifiants : fonctionnalité inerte", () => {
    expect(enabledSocialProviders(none)).toEqual([]);
    expect(buildSocialProviders(none)).toEqual({});
  });

  it("active seulement les fournisseurs configurés, dans l'ordre d'affichage", () => {
    expect(enabledSocialProviders({ ...none, MICROSOFT_CLIENT_ID: "m", MICROSOFT_CLIENT_SECRET: "s", GOOGLE_CLIENT_ID: "g", GOOGLE_CLIENT_SECRET: "s" })).toEqual([
      "google",
      "microsoft",
    ]);
    expect(enabledSocialProviders(all, NOW)).toEqual(["google", "facebook", "apple", "microsoft"]);
    expect(SOCIAL_PROVIDER_IDS.map((id) => SOCIAL_PROVIDER_LABELS[id])).toEqual(["Google", "Facebook", "Apple", "Microsoft"]);
  });

  it("minimise les données : portées par défaut, pas de jeton d'identité direct, pas de photo Microsoft", () => {
    const providers = buildSocialProviders(all, NOW);
    expect(Object.keys(providers)).toEqual(["google", "facebook", "apple", "microsoft"]);
    for (const config of Object.values(providers)) {
      expect(config).toMatchObject({ disableIdTokenSignIn: true });
      expect(config).not.toHaveProperty("mapProfileToUser");
      expect(config).not.toHaveProperty("overrideUserInfoOnSignIn");
    }
    expect(providers.google).toEqual({ clientId: "g-id", clientSecret: "g-secret", disableIdTokenSignIn: true });
    expect(providers.microsoft).toMatchObject({
      clientId: "m-id",
      clientSecret: "m-secret",
      tenantId: "consumers",
      disableProfilePhoto: true,
      disableDefaultScope: true,
      scope: ["openid", "profile", "email"],
    });
  });

  it("secret Apple expiré (ou illisible) : Apple seul est désactivé, boutons masqués et retour refusé", () => {
    const expired = { ...all, APPLE_CLIENT_SECRET: expiredApple };
    expect(enabledSocialProviders(expired, NOW)).toEqual(["google", "facebook", "microsoft"]);
    expect(buildSocialProviders(expired, NOW)).not.toHaveProperty("apple");
    expect(isAllowedOAuthCallback("apple", "POST", enabledSocialProviders(expired, NOW))).toBe(false);
    expect(isAppleSecretExpired(expired, NOW)).toBe(true);
    expect(isAppleSecretExpired(all, NOW)).toBe(false);
    expect(isAppleSecretExpired(none, NOW)).toBe(false);
    expect(enabledSocialProviders({ ...all, APPLE_CLIENT_SECRET: "a.b.c" }, NOW)).not.toContain("apple");
  });

  it("route de retour : GET pour un fournisseur actif, POST seulement pour Apple (form_post)", () => {
    const enabled = enabledSocialProviders(all, NOW);
    expect(isAllowedOAuthCallback("google", "GET", enabled)).toBe(true);
    expect(isAllowedOAuthCallback("google", "POST", enabled)).toBe(false);
    expect(isAllowedOAuthCallback("apple", "POST", enabled)).toBe(true);
    expect(isAllowedOAuthCallback("apple", "GET", enabled)).toBe(true);
    expect(isAllowedOAuthCallback("github", "GET", enabled)).toBe(false);
    expect(isAllowedOAuthCallback("google", "PUT", enabled)).toBe(false);
    expect(isAllowedOAuthCallback("google", "GET", ["microsoft"])).toBe(false);
    expect(isAllowedOAuthCallback("apple", "POST", [])).toBe(false);
    expect(isAllowedOAuthCallback("__proto__", "GET", enabled)).toBe(false);
  });

  it("n'accepte qu'une URL d'autorisation https chez le fournisseur attendu", () => {
    expect(isExpectedAuthorizationURL("google", "https://accounts.google.com/o/oauth2/v2/auth?x=1")).toBe(true);
    expect(isExpectedAuthorizationURL("google", "https://appleid.apple.com/auth/authorize")).toBe(false);
    expect(isExpectedAuthorizationURL("google", "http://accounts.google.com/o/oauth2/v2/auth")).toBe(false);
    expect(isExpectedAuthorizationURL("google", "https://accounts.google.com.evil.sn/")).toBe(false);
    expect(isExpectedAuthorizationURL("microsoft", "https://login.microsoftonline.com/consumers/oauth2/v2.0/authorize")).toBe(true);
    expect(isExpectedAuthorizationURL("facebook", "https://www.facebook.com/v24.0/dialog/oauth")).toBe(true);
    expect(isExpectedAuthorizationURL("apple", "pas une url")).toBe(false);
  });

  it("la CSP autorise l'envoi du formulaire vers chaque hôte d'autorisation", () => {
    for (const hosts of Object.values(PROVIDER_AUTHORIZATION_HOSTS)) {
      for (const host of hosts) expect(OAUTH_FORM_ORIGINS).toContain(`https://${host}`);
    }
  });
});
