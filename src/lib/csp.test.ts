import { describe, expect, it } from "vitest";
import { contentSecurityPolicy, OAUTH_FORM_ORIGINS } from "./csp";

const formAction = (csp: string) => csp.split("; ").find((directive) => directive.startsWith("form-action "));

describe("Content-Security-Policy", () => {
  it("politique stricte à nonce, sans unsafe-eval hors développement", () => {
    const csp = contentSecurityPolicy("abc", "/", false);
    expect(csp).toContain("script-src 'self' 'nonce-abc' 'strict-dynamic'");
    expect(csp).toContain("default-src 'self'");
    expect(csp).toContain("frame-ancestors 'none'");
    expect(csp).not.toContain("'unsafe-eval'");
    expect(contentSecurityPolicy("abc", "/", true)).toContain("'strict-dynamic' 'unsafe-eval'");
  });

  it("form-action limité à 'self' partout ailleurs que sur la connexion et l'inscription", () => {
    for (const path of ["/", "/compte", "/connexion/sociale", "/connexions", "/admin", "/inscription/x"]) {
      expect(formAction(contentSecurityPolicy("n", path, false))).toBe("form-action 'self'");
    }
  });

  it("connexion et inscription : ajoute exactement les origines des fournisseurs", () => {
    const expected = `form-action 'self' ${OAUTH_FORM_ORIGINS.join(" ")}`;
    expect(formAction(contentSecurityPolicy("n", "/connexion", false))).toBe(expected);
    expect(formAction(contentSecurityPolicy("n", "/inscription", false))).toBe(expected);
    expect(OAUTH_FORM_ORIGINS).toEqual([
      "https://accounts.google.com",
      "https://www.facebook.com",
      "https://appleid.apple.com",
      "https://login.microsoftonline.com",
      "https://login.live.com",
    ]);
  });
});
