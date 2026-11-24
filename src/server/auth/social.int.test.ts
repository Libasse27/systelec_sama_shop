import { randomUUID } from "node:crypto";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { syncRolesAndPermissions } from "@/server/authz/sync";
import { db } from "@/server/db/client";
import { logger } from "@/server/logger";
import { resetDatabase } from "../../../tests/setup/db";
import { createAuth, type ResetLink } from "./auth";
import { SOCIAL_START_LIMIT_PER_IP } from "./limits";
import { reconcileAfterPasswordReset } from "./social-accounts";
import { requestPasswordReset, resetPassword, signUpCustomer, startSocialSignIn, type RequestContext } from "./service";
import type { SocialEnv, SocialProviderId } from "./social-providers";

/**
 * Parcours OAuth réel de Better Auth, sans réseau : démarrage (état en base + cookie d'état signé), puis
 * retour sur /api/auth/callback/<id> via auth.handler, avec le point d'échange du code simulé (fetch).
 */
const APP_URL = "http://localhost:3000";
const LANDING = `${APP_URL}/connexion/sociale`;
const ERROR_URL = `${APP_URL}/connexion`;
const TOKEN_ENDPOINTS: Record<string, string> = {
  google: "https://oauth2.googleapis.com/token",
  facebook: "https://graph.facebook.com/v24.0/oauth/access_token",
  apple: "https://appleid.apple.com/auth/token",
};
const SECRET_TOKENS = { access_token: "jeton-acces-secret", refresh_token: "jeton-rafraichissement-secret" };

const socialEnv: SocialEnv = {
  GOOGLE_CLIENT_ID: "google-client",
  GOOGLE_CLIENT_SECRET: "google-secret",
  FACEBOOK_CLIENT_ID: "facebook-client",
  FACEBOOK_CLIENT_SECRET: "facebook-secret",
  APPLE_CLIENT_ID: "sn.futani.web",
  // Secret Apple factice mais lisible, valable un an (un secret expiré désactiverait Apple).
  APPLE_CLIENT_SECRET: `e30.${Buffer.from(JSON.stringify({ exp: Math.floor(Date.now() / 1000) + 365 * 24 * 3600 })).toString("base64url")}.sig`,
  MICROSOFT_TENANT_ID: "consumers",
};
const links: ResetLink[] = [];
const auth = createAuth({ socialEnv, deliverResetLink: async (link) => void links.push(link) });
const ctx: RequestContext = { headers: new Headers(), ip: "203.0.113.7" };
const customer = { name: "Awa Diop", email: "awa@example.sn", password: "motdepasse-solide" };

const base64url = (value: object) => Buffer.from(JSON.stringify(value)).toString("base64url");
const idToken = (claims: object) => `${base64url({ alg: "RS256", kid: "test" })}.${base64url(claims)}.signature`;

interface Identity {
  sub: string;
  email: string;
  emailVerified: boolean;
  name?: string;
}

/** Simule la réponse du point d'échange du code ; tout autre appel réseau fait échouer le test. */
function stubTokenEndpoint(provider: SocialProviderId, identity: Identity): void {
  const claims = {
    iss: provider === "google" ? "https://accounts.google.com" : `https://${provider}.example`,
    aud: socialEnv.GOOGLE_CLIENT_ID,
    sub: identity.sub,
    email: identity.email,
    email_verified: identity.emailVerified,
    name: identity.name ?? "Awa Google",
    picture: "https://photos.example/avatar.jpg",
  };
  vi.stubGlobal(
    "fetch",
    vi.fn(async (input: RequestInfo | URL) => {
      const url = input instanceof Request ? input.url : String(input);
      if (url.startsWith(TOKEN_ENDPOINTS[provider] ?? "\0")) {
        return Response.json({ ...SECRET_TOKENS, id_token: idToken(claims), token_type: "Bearer", expires_in: 3600 });
      }
      throw new Error(`Appel réseau inattendu en test : ${url}`);
    }),
  );
}

interface Flow {
  state: string;
  cookie: string;
  authorizationURL: URL;
}

async function startFlow(provider: SocialProviderId): Promise<Flow> {
  const { headers, response } = await auth.api.signInSocial({
    body: { provider, callbackURL: LANDING, newUserCallbackURL: LANDING, errorCallbackURL: ERROR_URL, disableRedirect: true },
    returnHeaders: true,
  });
  const authorizationURL = new URL(response.url ?? "");
  const cookie = headers
    .getSetCookie()
    .map((entry) => entry.split(";")[0])
    .join("; ");
  return { state: authorizationURL.searchParams.get("state") ?? "", cookie, authorizationURL };
}

async function callback(provider: SocialProviderId, flow: Flow, init: RequestInit = {}): Promise<Response> {
  const url = `${APP_URL}/api/auth/callback/${provider}?code=code-recu&state=${encodeURIComponent(flow.state)}`;
  return auth.handler(new Request(url, { headers: { cookie: flow.cookie }, ...init }));
}

async function signInWith(provider: SocialProviderId, identity: Identity): Promise<Response> {
  stubTokenEndpoint(provider, identity);
  return callback(provider, await startFlow(provider));
}

const location = (response: Response) => new URL(response.headers.get("location") ?? "", APP_URL);
const errorOf = (response: Response) => location(response).searchParams.get("error");
const providersOf = async (userId: string) =>
  (await db.account.findMany({ where: { userId }, orderBy: { providerId: "asc" } })).map((account) => account.providerId);

async function existingCustomer(emailVerified: boolean): Promise<string> {
  const { userId } = await signUpCustomer(auth, customer, ctx);
  await db.user.update({ where: { id: userId }, data: { emailVerified } });
  await db.session.deleteMany();
  return userId;
}

async function existingStaff(): Promise<string> {
  const userId = await existingCustomer(true);
  await db.user.update({
    where: { id: userId },
    data: { kind: "STAFF", roles: { create: { role: { connect: { code: "ADMIN" } } } } },
  });
  return userId;
}

const google: Identity = { sub: "google-sub-1", email: customer.email, emailVerified: true };

describe("connexion sociale (PostgreSQL, parcours OAuth sans réseau)", () => {
  beforeEach(async () => {
    await resetDatabase();
    await syncRolesAndPermissions(db);
    links.length = 0;
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it("démarrage : URL Google avec PKCE, état en base et cookie d'état, retour vers notre route", async () => {
    const flow = await startFlow("google");
    expect(flow.authorizationURL.origin).toBe("https://accounts.google.com");
    expect(flow.authorizationURL.searchParams.get("redirect_uri")).toBe(`${APP_URL}/api/auth/callback/google`);
    expect(flow.authorizationURL.searchParams.get("response_type")).toBe("code");
    expect(flow.authorizationURL.searchParams.get("code_challenge_method")).toBe("S256");
    expect(flow.authorizationURL.searchParams.get("scope")?.split(" ").sort()).toEqual(["email", "openid", "profile"]);
    expect(flow.cookie).toMatch(/state=/);
    expect(await db.verification.count()).toBe(1);
  });

  it("nouveau client Google : compte CLIENT vérifié, sans jeton ni avatar, session ouverte, journalisé", async () => {
    const response = await signInWith("google", { ...google, email: "nouveau@example.sn" });

    expect(response.status).toBe(302);
    expect(location(response).href).toBe(LANDING);
    expect(response.headers.getSetCookie().some((cookie) => cookie.startsWith("better-auth.session_token="))).toBe(true);
    const user = await db.user.findUniqueOrThrow({ where: { email: "nouveau@example.sn" }, include: { accounts: true, roles: true } });
    expect(user).toMatchObject({ kind: "CUSTOMER", isActive: true, emailVerified: true, image: null, name: "Awa Google" });
    expect(user.roles).toHaveLength(0);
    expect(user.accounts).toHaveLength(1);
    expect(user.accounts[0]).toMatchObject({
      providerId: "google",
      accountId: "google-sub-1",
      accessToken: null,
      refreshToken: null,
      idToken: null,
      accessTokenExpiresAt: null,
      refreshTokenExpiresAt: null,
      password: null,
    });
    expect(await db.session.count({ where: { userId: user.id } })).toBe(1);

    const actions = (await db.auditLog.findMany({ where: { entityId: user.id } })).map((log) => log.action).sort();
    expect(actions).toEqual(["auth.social.login", "auth.social.signup"]);
    const journal = JSON.stringify(await db.auditLog.findMany());
    for (const secret of [SECRET_TOKENS.access_token, SECRET_TOKENS.refresh_token, "nouveau@example.sn", "code-recu", "avatar"]) {
      expect(journal).not.toContain(secret);
    }
  });

  it("Apple sans nom : nom tiré de l'e-mail ; retour en POST (form_post) accepté sans origine de confiance", async () => {
    stubTokenEndpoint("apple", { sub: "apple-sub", email: "x7k2p9@privaterelay.appleid.com", emailVerified: true, name: "" });
    const flow = await startFlow("apple");
    const posted = await auth.handler(
      new Request(`${APP_URL}/api/auth/callback/apple`, {
        method: "POST",
        headers: { "content-type": "application/x-www-form-urlencoded", origin: "https://appleid.apple.com" },
        body: new URLSearchParams({ code: "code-recu", state: flow.state }),
      }),
    );
    // Le navigateur ne renvoie pas le cookie d'état (SameSite=Lax) sur ce POST inter-sites : Better Auth
    // rebondit en GET sur la même route, où le cookie est présent.
    expect(posted.status).toBe(302);
    const bounce = location(posted);
    expect(bounce.pathname).toBe("/api/auth/callback/apple");

    const response = await auth.handler(new Request(bounce, { headers: { cookie: flow.cookie } }));
    expect(location(response).href).toBe(LANDING);
    const user = await db.user.findUniqueOrThrow({ where: { email: "x7k2p9@privaterelay.appleid.com" } });
    expect(user).toMatchObject({ name: "x7k2p9", kind: "CUSTOMER", image: null });
  });

  it("client existant à l'e-mail NON vérifié : aucune liaison (account_not_linked), aucune session", async () => {
    const userId = await existingCustomer(false);
    const response = await signInWith("google", google);

    expect(location(response).pathname).toBe("/connexion");
    expect(errorOf(response)).toBe("account_not_linked");
    expect(await providersOf(userId)).toEqual(["credential"]);
    expect(await db.session.count()).toBe(0);
  });

  it("client existant vérifié + Google vérifié : compte relié (sans jeton), session ouverte, liaison journalisée", async () => {
    const userId = await existingCustomer(true);
    const response = await signInWith("google", google);

    expect(location(response).href).toBe(LANDING);
    expect(await providersOf(userId)).toEqual(["credential", "google"]);
    const linked = await db.account.findFirstOrThrow({ where: { userId, providerId: "google" } });
    expect(linked).toMatchObject({ accessToken: null, refreshToken: null, idToken: null });
    // Pas de mise à jour du profil à la liaison.
    expect(await db.user.findUniqueOrThrow({ where: { id: userId } })).toMatchObject({ name: customer.name, image: null });
    expect(await db.auditLog.count({ where: { action: "auth.social.link", entityId: userId } })).toBe(1);
    expect(await db.session.count({ where: { userId } })).toBe(1);
  });

  it("Facebook face à un client existant vérifié : jamais relié", async () => {
    const userId = await existingCustomer(true);
    const response = await signInWith("facebook", { sub: "fb-1", email: customer.email, emailVerified: true });

    expect(errorOf(response)).toBe("account_not_linked");
    expect(await providersOf(userId)).toEqual(["credential"]);
    expect(await db.session.count()).toBe(0);
  });

  it("personnel + Google vérifié : refusé, aucun compte relié, aucune session, refus journalisé", async () => {
    const staffId = await existingStaff();
    const response = await signInWith("google", google);

    expect(location(response).pathname).toBe("/connexion");
    expect(errorOf(response)).toBe("social_not_allowed");
    expect(await providersOf(staffId)).toEqual(["credential"]);
    expect(await db.session.count()).toBe(0);
    const blocked = await db.auditLog.findFirstOrThrow({ where: { action: "auth.social.blocked", entityId: staffId } });
    expect(blocked).toMatchObject({ result: "DENIED", after: { provider: "google", reason: "social_not_allowed" } });
  });

  it("personnel déjà relié à Google (avant sa promotion) : refusé à la connexion, aucune session", async () => {
    const staffId = await existingStaff();
    await db.account.create({ data: { id: randomUUID(), userId: staffId, providerId: "google", accountId: google.sub } });
    const response = await signInWith("google", google);

    expect(errorOf(response)).toBe("social_not_allowed");
    expect(await db.session.count()).toBe(0);
  });

  it("client désactivé déjà relié : aucune session", async () => {
    const userId = await existingCustomer(true);
    await db.account.create({ data: { id: randomUUID(), userId, providerId: "google", accountId: google.sub } });
    await db.user.update({ where: { id: userId }, data: { isActive: false } });
    const response = await signInWith("google", google);

    expect(errorOf(response)).toBe("unable_to_create_session");
    expect(await db.session.count()).toBe(0);
  });

  it("refuse un retour sans cookie d'état (état expiré ou volé) vers la page de connexion", async () => {
    stubTokenEndpoint("google", google);
    const flow = await startFlow("google");
    const response = await callback("google", { ...flow, cookie: "" });

    expect(location(response).pathname).toBe("/connexion");
    expect(errorOf(response)).toBe("state_mismatch");
    expect(await db.user.count()).toBe(0);
  });

  it("réinitialisation du mot de passe : e-mail vérifié, comptes sociaux détachés, journalisé", async () => {
    const userId = await existingCustomer(false);
    await db.account.create({ data: { id: randomUUID(), userId, providerId: "facebook", accountId: "fb-attaquant" } });

    await requestPasswordReset(auth, { email: customer.email }, ctx);
    const token = new URL(links[0]!.url).searchParams.get("token");
    await resetPassword(auth, { token, password: "nouveau-mot-de-passe" }, ctx);

    expect((await db.user.findUniqueOrThrow({ where: { id: userId } })).emailVerified).toBe(true);
    expect(await providersOf(userId)).toEqual(["credential"]);
    const actions = (await db.auditLog.findMany({ where: { entityId: userId } })).map((log) => log.action);
    expect(actions).toEqual(expect.arrayContaining(["auth.email_verified", "auth.social.unlink", "auth.password_reset"]));
    expect(await db.auditLog.findFirstOrThrow({ where: { action: "auth.social.unlink" } })).toMatchObject({
      after: { providers: ["facebook"], reason: "password_reset" },
    });
  });

  it("réconciliation après réinitialisation : idempotente, sessions révoquées quand un compte social est détaché", async () => {
    const userId = await existingCustomer(false);
    await db.account.create({ data: { id: randomUUID(), userId, providerId: "google", accountId: "google-sub" } });
    await db.session.create({ data: { id: randomUUID(), token: randomUUID(), userId, expiresAt: new Date(Date.now() + 3_600_000) } });

    await reconcileAfterPasswordReset(db, userId);
    await reconcileAfterPasswordReset(db, userId);

    expect((await db.user.findUniqueOrThrow({ where: { id: userId } })).emailVerified).toBe(true);
    expect(await providersOf(userId)).toEqual(["credential"]);
    expect(await db.session.count({ where: { userId } })).toBe(0);
    expect(await db.auditLog.count({ where: { action: "auth.email_verified", entityId: userId } })).toBe(1);
    expect(await db.auditLog.count({ where: { action: "auth.social.unlink", entityId: userId } })).toBe(1);
  });

  it("rappel onPasswordReset en échec : journalisé sans donnée personnelle, le service purge quand même", async () => {
    const errors = vi.spyOn(logger, "error").mockImplementation(() => undefined);
    const failing = createAuth({
      socialEnv,
      deliverResetLink: async (link) => void links.push(link),
      reconcileAfterReset: async () => {
        throw new Error(`panne simulée pour ${customer.email}`);
      },
    });
    const userId = await existingCustomer(false);
    await db.account.create({ data: { id: randomUUID(), userId, providerId: "facebook", accountId: "fb-attaquant" } });

    await requestPasswordReset(failing, { email: customer.email }, ctx);
    const token = new URL(links[0]!.url).searchParams.get("token");
    await resetPassword(failing, { token, password: "nouveau-mot-de-passe" }, ctx);

    expect((await db.user.findUniqueOrThrow({ where: { id: userId } })).emailVerified).toBe(true);
    expect(await providersOf(userId)).toEqual(["credential"]);
    expect(await db.auditLog.count({ where: { action: "auth.password_reset", entityId: userId } })).toBe(1);
    expect(errors).toHaveBeenCalledWith(expect.stringContaining("Réconciliation après réinitialisation"), { error: "Error" });
    expect(JSON.stringify(errors.mock.calls)).not.toContain(customer.email);
  });

  it("réinitialisation avec un jeton invalide : erreur de validation, aucune réconciliation", async () => {
    const userId = await existingCustomer(false);
    await db.account.create({ data: { id: randomUUID(), userId, providerId: "facebook", accountId: "fb-attaquant" } });

    await expect(resetPassword(auth, { token: "jeton-inconnu", password: "nouveau-mot-de-passe" }, ctx)).rejects.toMatchObject({
      code: "VALIDATION",
    });

    expect((await db.user.findUniqueOrThrow({ where: { id: userId } })).emailVerified).toBe(false);
    expect(await providersOf(userId)).toEqual(["credential", "facebook"]);
    expect(await db.auditLog.count({ where: { action: { in: ["auth.email_verified", "auth.social.unlink"] } } })).toBe(0);
  });

  it("réinitialisation : les deux réconciliations en échec, le mot de passe est changé et le service réussit", async () => {
    const errors = vi.spyOn(logger, "error").mockImplementation(() => undefined);
    const failingReconcile = async () => {
      throw new Error(`panne simulée pour ${customer.email}`);
    };
    const failing = createAuth({ socialEnv, deliverResetLink: async (link) => void links.push(link), reconcileAfterReset: failingReconcile });
    const userId = await existingCustomer(false);
    const hashBefore = (await db.account.findFirstOrThrow({ where: { userId, providerId: "credential" } })).password;

    await requestPasswordReset(failing, { email: customer.email }, ctx);
    const token = new URL(links[0]!.url).searchParams.get("token");
    await expect(resetPassword(failing, { token, password: "nouveau-mot-de-passe" }, ctx, failingReconcile)).resolves.toBeUndefined();

    const hashAfter = (await db.account.findFirstOrThrow({ where: { userId, providerId: "credential" } })).password;
    expect(hashAfter).not.toBe(hashBefore);
    expect(errors).toHaveBeenCalledWith(expect.stringContaining("Seconde réconciliation"), { userId, error: "Error" });
    expect(JSON.stringify(errors.mock.calls)).not.toContain(customer.email);
  });

  it("startSocialSignIn : fournisseur inactif refusé, URL vérifiée, destination sûre, plafond par IP", async () => {
    await expect(startSocialSignIn(auth, { provider: "facebook" }, ctx, ["google"])).rejects.toMatchObject({ code: "VALIDATION" });
    await expect(startSocialSignIn(auth, { provider: "github" }, ctx, ["google"])).rejects.toMatchObject({ code: "VALIDATION" });

    const url = new URL(await startSocialSignIn(auth, { provider: "google", suivant: "//evil.example" }, ctx, ["google"]));
    expect(url.hostname).toBe("accounts.google.com");
    const stored = await db.verification.findFirstOrThrow();
    expect(JSON.parse(stored.value)).toMatchObject({ callbackURL: LANDING, newUserURL: LANDING, errorURL: ERROR_URL });

    await startSocialSignIn(auth, { provider: "google", suivant: "/panier" }, ctx, ["google"]);
    const withNext = await db.verification.findFirstOrThrow({ orderBy: { createdAt: "desc" } });
    expect(JSON.parse(withNext.value).callbackURL).toBe(`${LANDING}?suivant=%2Fpanier`);

    for (let i = 2; i < SOCIAL_START_LIMIT_PER_IP; i += 1) await startSocialSignIn(auth, { provider: "google" }, ctx, ["google"]);
    await expect(startSocialSignIn(auth, { provider: "google" }, ctx, ["google"])).rejects.toMatchObject({ code: "RATE_LIMITED" });
    await expect(
      startSocialSignIn(auth, { provider: "google" }, { headers: new Headers(), ip: "198.51.100.9" }, ["google"]),
    ).resolves.toMatch(/^https:\/\/accounts\.google\.com\//);
  });
});
