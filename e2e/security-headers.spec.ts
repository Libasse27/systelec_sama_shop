import { expect, test, type APIResponse } from "@playwright/test";

/**
 * Référence avant toute montée de version de Next.js : en-têtes de sécurité statiques
 * (next.config.ts, appliqués à toutes les routes) et Content-Security-Policy à nonce par requête
 * (src/proxy.ts et src/lib/csp.ts, pages uniquement : le matcher exclut /api).
 */
const STATIC_HEADERS = {
  "x-content-type-options": "nosniff",
  "x-frame-options": "DENY",
  "referrer-policy": "strict-origin-when-cross-origin",
  "permissions-policy": "camera=(), microphone=(), geolocation=(), payment=()",
  // Posé aussi en http ; seul le navigateur l'ignore hors TLS.
  "strict-transport-security": "max-age=63072000; includeSubDomains",
};

const NONCE_PATTERN = /script-src 'self' 'nonce-([A-Za-z0-9+/=]+)' 'strict-dynamic'(?:;|$)/;

const nonceOf = (response: APIResponse): string => {
  const match = response.headers()["content-security-policy"]?.match(NONCE_PATTERN);
  expect(match?.[1], "nonce absent de la CSP").toBeDefined();
  return match?.[1] ?? "";
};

test.describe("en-têtes de sécurité", () => {
  test.beforeEach(({}, testInfo) => {
    test.skip(testInfo.project.name !== "desktop", "En-têtes HTTP du serveur : vérifiés sur le profil bureau uniquement.");
  });

  for (const path of ["/", "/api/health"]) {
    test(`${path} : en-têtes statiques présents, sans x-powered-by`, async ({ request }) => {
      const response = await request.get(path);
      expect(response.status()).toBe(200);
      const headers = response.headers();
      expect(headers).toMatchObject(STATIC_HEADERS);
      expect(headers["x-powered-by"]).toBeUndefined();
    });
  }

  test("page publique : CSP stricte avec un nonce différent à chaque requête", async ({ request }) => {
    const first = await request.get("/");
    const csp = first.headers()["content-security-policy"];
    for (const directive of [
      "default-src 'self'",
      "connect-src 'self'",
      "object-src 'none'",
      "base-uri 'self'",
      "form-action 'self'",
      "frame-ancestors 'none'",
    ]) {
      expect(csp).toContain(directive);
    }
    expect(csp).not.toContain("'unsafe-eval'");

    const nonce = nonceOf(first);
    expect(await first.text()).toContain(`nonce="${nonce}"`);
    expect(nonceOf(await request.get("/"))).not.toBe(nonce);
  });

  test("form-action : 'self' seul hors connexion ; origines des fournisseurs sur /connexion et /inscription", async ({ request }) => {
    const formAction = async (path: string) =>
      ((await request.get(path)).headers()["content-security-policy"] ?? "").split("; ").find((d) => d.startsWith("form-action "));
    expect(await formAction("/")).toBe("form-action 'self'");
    const providers =
      "form-action 'self' https://accounts.google.com https://www.facebook.com https://appleid.apple.com https://login.microsoftonline.com https://login.live.com";
    expect(await formAction("/connexion")).toBe(providers);
    expect(await formAction("/inscription")).toBe(providers);
  });

  test("/api/health : pas de CSP (hors du matcher du proxy)", async ({ request }) => {
    const response = await request.get("/api/health");
    expect(response.headers()["content-security-policy"]).toBeUndefined();
  });
});
