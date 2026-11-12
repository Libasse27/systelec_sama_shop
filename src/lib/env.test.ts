import { describe, expect, it } from "vitest";
import { parseServerEnv } from "./env";

const DATABASE_URL = "postgresql://user:pass@localhost:5432/db";
const AUTH_SECRET = "x".repeat(32);
const base = { DATABASE_URL, AUTH_SECRET };

describe("configuration serveur", () => {
  it("applique les valeurs par défaut en développement", () => {
    const env = parseServerEnv(base);
    expect(env.APP_ENV).toBe("development");
    expect(env.APP_URL).toBe("http://localhost:3000");
    expect(env.SMTP_HOST).toBeUndefined();
  });

  it("refuse une DATABASE_URL qui n'est pas PostgreSQL", () => {
    expect(() => parseServerEnv({ ...base, DATABASE_URL: "mysql://localhost/db" })).toThrow(/DATABASE_URL/);
  });

  it("exige un secret de session d'au moins 32 caractères", () => {
    expect(() => parseServerEnv({ DATABASE_URL })).toThrow(/AUTH_SECRET/);
    expect(() => parseServerEnv({ ...base, AUTH_SECRET: "court" })).toThrow(/AUTH_SECRET/);
  });

  it("considère l'e-mail désactivé quand SMTP_HOST est vide", () => {
    expect(parseServerEnv({ ...base, SMTP_HOST: "", SMTP_PORT: "" }).SMTP_HOST).toBeUndefined();
  });

  it("e-mail activé : port et expéditeur exigés, identifiants complets ou absents", () => {
    const smtp = { ...base, SMTP_HOST: "smtp-relay.brevo.com", SMTP_PORT: "587", SMTP_FROM: "Boutique <contact@futani.sn>" };
    expect(parseServerEnv(smtp).SMTP_PORT).toBe(587);
    expect(parseServerEnv({ ...smtp, SMTP_USER: "compte", SMTP_PASSWORD: "cle" }).SMTP_USER).toBe("compte");
    expect(() => parseServerEnv({ ...smtp, SMTP_PORT: "" })).toThrow(/SMTP_PORT/);
    expect(() => parseServerEnv({ ...smtp, SMTP_FROM: "" })).toThrow(/SMTP_FROM/);
    expect(() => parseServerEnv({ ...smtp, SMTP_USER: "compte" })).toThrow(/SMTP_PASSWORD/);
    expect(() => parseServerEnv({ ...smtp, SMTP_PASSWORD: "cle" })).toThrow(/SMTP_PASSWORD/);
  });

  it("réserve de connexions PostgreSQL : 10 par défaut, bornée", () => {
    expect(parseServerEnv(base).DATABASE_POOL_MAX).toBe(10);
    expect(parseServerEnv({ ...base, DATABASE_POOL_MAX: "20" }).DATABASE_POOL_MAX).toBe(20);
    expect(() => parseServerEnv({ ...base, DATABASE_POOL_MAX: "0" })).toThrow(/DATABASE_POOL_MAX/);
    expect(() => parseServerEnv({ ...base, DATABASE_POOL_MAX: "500" })).toThrow(/DATABASE_POOL_MAX/);
  });

  it("exige en production une APP_URL explicite, en https, sans slash final", () => {
    const prod = { ...base, APP_ENV: "production" };
    expect(() => parseServerEnv(prod)).toThrow(/APP_URL/);
    expect(() => parseServerEnv({ ...prod, APP_URL: "http://futani.sn" })).toThrow(/APP_URL/);
    expect(() => parseServerEnv({ ...prod, APP_URL: "https://futani.sn/" })).toThrow(/APP_URL/);
    expect(parseServerEnv({ ...prod, APP_URL: "https://futani.sn" }).APP_URL).toBe("https://futani.sn");
  });
});

const base64url = (value: object) => Buffer.from(JSON.stringify(value)).toString("base64url");
const appleSecret = (payload: object) => `${base64url({ alg: "ES256", kid: "ABC123" })}.${base64url(payload)}.signature`;
const inDays = (days: number) => Math.floor(Date.now() / 1000) + days * 24 * 3600;

describe("connexion sociale (configuration)", () => {
  it("désactivée par défaut ; une chaîne vide vaut absence ; Microsoft vise les comptes personnels", () => {
    const env = parseServerEnv({ ...base, GOOGLE_CLIENT_ID: "", GOOGLE_CLIENT_SECRET: "" });
    expect(env.GOOGLE_CLIENT_ID).toBeUndefined();
    expect(env.FACEBOOK_CLIENT_ID).toBeUndefined();
    expect(env.APPLE_CLIENT_SECRET).toBeUndefined();
    expect(env.MICROSOFT_TENANT_ID).toBe("consumers");
  });

  it("identifiant et secret vont ensemble, pour chaque fournisseur", () => {
    expect(parseServerEnv({ ...base, GOOGLE_CLIENT_ID: "id", GOOGLE_CLIENT_SECRET: "secret" }).GOOGLE_CLIENT_ID).toBe("id");
    expect(() => parseServerEnv({ ...base, GOOGLE_CLIENT_ID: "id" })).toThrow(/GOOGLE_CLIENT_SECRET/);
    expect(() => parseServerEnv({ ...base, FACEBOOK_CLIENT_SECRET: "secret" })).toThrow(/FACEBOOK_CLIENT_ID/);
    expect(() => parseServerEnv({ ...base, MICROSOFT_CLIENT_ID: "id" })).toThrow(/MICROSOFT_CLIENT_SECRET/);
    expect(() => parseServerEnv({ ...base, APPLE_CLIENT_SECRET: appleSecret({ exp: inDays(30) }) })).toThrow(/APPLE_CLIENT_ID/);
  });

  it("Apple : secret JWT pré-généré, refusé au démarrage s'il est mal formé ou sans expiration", () => {
    const apple = { ...base, APPLE_CLIENT_ID: "sn.futani.web" };
    expect(parseServerEnv({ ...apple, APPLE_CLIENT_SECRET: appleSecret({ exp: inDays(90) }) }).APPLE_CLIENT_ID).toBe("sn.futani.web");
    expect(() => parseServerEnv({ ...apple, APPLE_CLIENT_SECRET: "pas-un-jwt" })).toThrow(/APPLE_CLIENT_SECRET/);
    expect(() => parseServerEnv({ ...apple, APPLE_CLIENT_SECRET: "a.!!!.c" })).toThrow(/APPLE_CLIENT_SECRET/);
    expect(() => parseServerEnv({ ...apple, APPLE_CLIENT_SECRET: appleSecret({ iss: "TEAM" }) })).toThrow(/APPLE_CLIENT_SECRET/);
  });

  it("Apple : un secret expiré n'empêche pas le démarrage (seul Apple est désactivé, social-providers.ts)", () => {
    const expired = appleSecret({ exp: inDays(-1) });
    expect(parseServerEnv({ ...base, APPLE_CLIENT_ID: "sn.futani.web", APPLE_CLIENT_SECRET: expired }).APPLE_CLIENT_SECRET).toBe(expired);
  });

  it("Microsoft : locataire consumers, common ou identifiant GUID uniquement", () => {
    expect(parseServerEnv({ ...base, MICROSOFT_TENANT_ID: "common" }).MICROSOFT_TENANT_ID).toBe("common");
    const guid = "9188040d-6c67-4c5b-b112-36a304b66dad";
    expect(parseServerEnv({ ...base, MICROSOFT_TENANT_ID: guid }).MICROSOFT_TENANT_ID).toBe(guid);
    expect(parseServerEnv({ ...base, MICROSOFT_TENANT_ID: "" }).MICROSOFT_TENANT_ID).toBe("consumers");
    expect(() => parseServerEnv({ ...base, MICROSOFT_TENANT_ID: "organizations" })).toThrow(/MICROSOFT_TENANT_ID/);
    expect(() => parseServerEnv({ ...base, MICROSOFT_TENANT_ID: "../evil" })).toThrow(/MICROSOFT_TENANT_ID/);
  });
});
