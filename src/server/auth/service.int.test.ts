import { beforeEach, describe, expect, it } from "vitest";
import { db } from "@/server/db/client";
import { resetDatabase } from "../../../tests/setup/db";
import { createAuth, type ResetLink } from "./auth";
import { LOGIN_LIMITS, RESET_REQUEST_LIMITS, SIGNUP_LIMIT_PER_IP } from "./limits";
import { requestPasswordReset, resetPassword, signIn, signOut, signUpCustomer, type RequestContext } from "./service";

const links: ResetLink[] = [];
const auth = createAuth({ deliverResetLink: async (link) => void links.push(link) });
const ctx: RequestContext = { headers: new Headers(), ip: "203.0.113.7" };
const otherIp: RequestContext = { headers: new Headers(), ip: "198.51.100.9" };
const customer = { name: "Awa Diop", email: "awa@example.sn", phone: "+221 77 000 00 00", password: "motdepasse-solide" };
const wrong = (i = 0) => ({ email: customer.email, password: `faux-mot-de-passe-${i}` });

const loginResults = async () =>
  (await db.auditLog.findMany({ where: { action: "auth.login" } })).map((log) => log.result).sort();

describe("authentification (PostgreSQL)", () => {
  beforeEach(async () => {
    await resetDatabase();
    links.length = 0;
  });

  it("crée un compte client sans rôle, journalisé, sans jamais stocker le mot de passe en clair (§20 n° 1)", async () => {
    const { userId } = await signUpCustomer(auth, { ...customer, kind: "STAFF" }, ctx);

    const user = await db.user.findUniqueOrThrow({ where: { id: userId }, include: { roles: true, accounts: true } });
    expect(user).toMatchObject({ email: "awa@example.sn", kind: "CUSTOMER", isActive: true, phone: customer.phone });
    expect(user.roles).toHaveLength(0);
    expect(user.accounts[0]?.password).toBeTruthy();
    expect(user.accounts[0]?.password).not.toContain(customer.password);

    const log = await db.auditLog.findFirstOrThrow({ where: { action: "auth.signup" } });
    expect(log).toMatchObject({ actorId: userId, entityId: userId, result: "SUCCESS", ip: ctx.ip });
    expect(JSON.stringify(await db.auditLog.findMany())).not.toContain(customer.password);
  });

  it("refuse un second compte avec le même e-mail", async () => {
    await signUpCustomer(auth, customer, ctx);
    await expect(signUpCustomer(auth, customer, ctx)).rejects.toMatchObject({ code: "CONFLICT" });
    expect(await db.user.count()).toBe(1);
  });

  it("limite le nombre d'inscriptions par IP", async () => {
    for (let i = 0; i < SIGNUP_LIMIT_PER_IP; i += 1) {
      await signUpCustomer(auth, { ...customer, email: `client${i}@example.sn` }, ctx);
    }
    await expect(signUpCustomer(auth, { ...customer, email: "encore@example.sn" }, ctx)).rejects.toMatchObject({
      code: "RATE_LIMITED",
    });
  });

  it("connecte avec les bons identifiants et journalise succès et échecs (§20 n° 1 et 24)", async () => {
    const { userId } = await signUpCustomer(auth, customer, ctx);

    await expect(signIn(auth, { email: "AWA@example.sn", password: customer.password }, ctx)).resolves.toEqual({
      userId,
      kind: "CUSTOMER",
    });
    await expect(signIn(auth, wrong(), ctx)).rejects.toMatchObject({ code: "UNAUTHENTICATED" });

    const success = await db.auditLog.findFirstOrThrow({ where: { action: "auth.login", result: "SUCCESS" } });
    expect(success).toMatchObject({ actorId: userId, entityType: "LoginAttempt", entityId: customer.email, ip: ctx.ip });
    const failure = await db.auditLog.findFirstOrThrow({ where: { action: "auth.login", result: "FAILURE" } });
    expect(failure).toMatchObject({ actorId: null, entityId: customer.email });
  });

  it("bloque le couple e-mail/IP après trop d'échecs, sans bloquer le titulaire depuis une autre IP", async () => {
    await signUpCustomer(auth, customer, ctx);
    for (let i = 0; i < LOGIN_LIMITS.perEmailAndIp; i += 1) {
      await expect(signIn(auth, wrong(i), ctx)).rejects.toMatchObject({ code: "UNAUTHENTICATED" });
    }
    await expect(signIn(auth, { email: customer.email, password: customer.password }, ctx)).rejects.toMatchObject({
      code: "RATE_LIMITED",
    });
    await expect(signIn(auth, { email: customer.email, password: customer.password }, otherIp)).resolves.toMatchObject({
      kind: "CUSTOMER",
    });
  });

  it("tient le plafond face à des tentatives simultanées (verrou par e-mail)", async () => {
    await signUpCustomer(auth, customer, ctx);
    const attempts = await Promise.allSettled(Array.from({ length: 12 }, (_, i) => signIn(auth, wrong(i), ctx)));
    expect(attempts.every((attempt) => attempt.status === "rejected")).toBe(true);
    const results = await loginResults();
    expect(results.filter((r) => r === "FAILURE")).toHaveLength(LOGIN_LIMITS.perEmailAndIp);
    // Un seul refus journalisé par fenêtre, quel que soit le nombre de requêtes bloquées.
    expect(results.filter((r) => r === "DENIED")).toHaveLength(1);
  });

  it("remet le compteur à zéro après une connexion réussie", async () => {
    await signUpCustomer(auth, customer, ctx);
    for (let i = 0; i < LOGIN_LIMITS.perEmailAndIp - 1; i += 1) await signIn(auth, wrong(i), ctx).catch(() => undefined);
    await signIn(auth, { email: customer.email, password: customer.password }, ctx);
    await expect(signIn(auth, wrong(99), ctx)).rejects.toMatchObject({ code: "UNAUTHENTICATED" });
  });

  it("bloque une IP qui essaie de nombreux comptes (pulvérisation)", async () => {
    for (let i = 0; i < LOGIN_LIMITS.perIp; i += 1) {
      await signIn(auth, { email: `cible${i}@example.sn`, password: "mot-de-passe-courant" }, ctx).catch(() => undefined);
    }
    await expect(signIn(auth, { email: "nouvelle@example.sn", password: "mot-de-passe-courant" }, ctx)).rejects.toMatchObject(
      { code: "RATE_LIMITED" },
    );
  });

  it("refuse la connexion d'un compte désactivé, sans ouvrir de session", async () => {
    const { userId } = await signUpCustomer(auth, customer, ctx);
    await db.session.deleteMany();
    await db.user.update({ where: { id: userId }, data: { isActive: false } });
    await expect(signIn(auth, { email: customer.email, password: customer.password }, ctx)).rejects.toMatchObject({
      code: "UNAUTHENTICATED",
    });
    expect(await db.session.count()).toBe(0);
    expect(await loginResults()).toEqual(["FAILURE"]);
  });

  it("déconnecte en révoquant la session en base", async () => {
    const result = await auth.api.signUpEmail({ body: customer, asResponse: true });
    const cookie = result.headers.get("set-cookie") ?? "";
    expect(await db.session.count()).toBe(1);

    await signOut(auth, { headers: new Headers({ cookie }), ip: ctx.ip });
    expect(await db.session.count()).toBe(0);
    expect(await db.auditLog.count({ where: { action: "auth.logout" } })).toBe(1);
  });

  it("réinitialise le mot de passe via le lien, révoque les sessions et journalise le compte concerné", async () => {
    const { userId } = await signUpCustomer(auth, customer, ctx);
    await requestPasswordReset(auth, { email: customer.email }, ctx);
    expect(links).toHaveLength(1);
    const url = new URL(links[0]!.url);
    expect(url.pathname).toBe("/reinitialiser-mot-de-passe");
    const token = url.searchParams.get("token");

    const newPassword = "nouveau-mot-de-passe";
    await resetPassword(auth, { token, password: newPassword }, ctx);
    expect(await db.session.count()).toBe(0);
    expect(await db.auditLog.findFirstOrThrow({ where: { action: "auth.password_reset" } })).toMatchObject({
      actorId: userId,
      entityId: userId,
      result: "SUCCESS",
    });
    await expect(signIn(auth, { email: customer.email, password: customer.password }, ctx)).rejects.toMatchObject({
      code: "UNAUTHENTICATED",
    });
    await expect(signIn(auth, { email: customer.email, password: newPassword }, ctx)).resolves.toMatchObject({
      kind: "CUSTOMER",
    });
    // Jeton à usage unique.
    await expect(resetPassword(auth, { token, password: "encore-un-autre" }, ctx)).rejects.toMatchObject({
      code: "VALIDATION",
    });
  });

  it("refuse un jeton de réinitialisation inconnu et journalise l'échec", async () => {
    await expect(resetPassword(auth, { token: "jeton-invente", password: "nouveau-mot-de-passe" }, ctx)).rejects.toMatchObject(
      { code: "VALIDATION" },
    );
    expect(await db.auditLog.count({ where: { action: "auth.password_reset", result: "FAILURE" } })).toBe(1);
  });

  it("répond de façon neutre pour une adresse inconnue", async () => {
    await expect(requestPasswordReset(auth, { email: "inconnu@example.sn" }, ctx)).resolves.toBeUndefined();
    expect(links).toHaveLength(0);
  });

  it("ignore silencieusement les demandes de réinitialisation au-delà du plafond", async () => {
    await signUpCustomer(auth, customer, ctx);
    for (let i = 0; i < RESET_REQUEST_LIMITS.perEmail + 2; i += 1) {
      await expect(requestPasswordReset(auth, { email: customer.email }, ctx)).resolves.toBeUndefined();
    }
    expect(links).toHaveLength(RESET_REQUEST_LIMITS.perEmail);
  });
});
