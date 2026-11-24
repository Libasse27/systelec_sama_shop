import { describe, expect, it } from "vitest";
import { CLEARED_TOKENS, hasTokenFields, isOAuthPath, socialDisplayName, socialRefusal, SOCIAL_NAME_MAX } from "./social-policy";

describe("politique de la connexion sociale", () => {
  it("réservée aux clients actifs : personnel refusé (même désactivé), compte désactivé refusé", () => {
    expect(socialRefusal({ kind: "CUSTOMER", isActive: true, roleCount: 0 })).toBeNull();
    expect(socialRefusal({ kind: "STAFF", isActive: true, roleCount: 1 })).toBe("social_not_allowed");
    expect(socialRefusal({ kind: "STAFF", isActive: true, roleCount: 0 })).toBe("social_not_allowed");
    // Rôle présent mais kind incohérent : traité comme du personnel.
    expect(socialRefusal({ kind: "CUSTOMER", isActive: true, roleCount: 2 })).toBe("social_not_allowed");
    expect(socialRefusal({ kind: "STAFF", isActive: false, roleCount: 1 })).toBe("social_not_allowed");
    expect(socialRefusal({ kind: "CUSTOMER", isActive: false, roleCount: 0 })).toBe("unable_to_create_session");
  });

  it("reconnaît les requêtes issues d'un fournisseur", () => {
    expect(isOAuthPath("/callback/google")).toBe(true);
    expect(isOAuthPath("/callback/:id")).toBe(true);
    expect(isOAuthPath("/sign-in/social")).toBe(true);
    expect(isOAuthPath("/sign-in/email")).toBe(false);
    expect(isOAuthPath("/sign-up/email")).toBe(false);
    expect(isOAuthPath("/reset-password")).toBe(false);
    expect(isOAuthPath(undefined)).toBe(false);
  });

  it("nom du compte : celui du fournisseur, sinon la partie locale de l'e-mail, sinon « Client », borné", () => {
    expect(socialDisplayName("  Awa Diop ", "awa@example.sn")).toBe("Awa Diop");
    expect(socialDisplayName("", "x7k2p9@privaterelay.appleid.com")).toBe("x7k2p9");
    expect(socialDisplayName(undefined, undefined)).toBe("Client");
    expect(socialDisplayName("   ", "@example.sn")).toBe("Client");
    expect(socialDisplayName("a".repeat(300), "awa@example.sn")).toHaveLength(SOCIAL_NAME_MAX);
  });

  it("efface tous les jetons OAuth et leurs expirations", () => {
    expect(CLEARED_TOKENS).toEqual({
      accessToken: null,
      refreshToken: null,
      idToken: null,
      accessTokenExpiresAt: null,
      refreshTokenExpiresAt: null,
    });
    expect(hasTokenFields({ accessToken: "x" })).toBe(true);
    expect(hasTokenFields({ refreshTokenExpiresAt: new Date() })).toBe(true);
    expect(hasTokenFields({ password: "hash" })).toBe(false);
  });
});
