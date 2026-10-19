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
    const smtp = { ...base, SMTP_HOST: "smtp-relay.brevo.com", SMTP_PORT: "587", SMTP_FROM: "Boutique <contact@systelec.sn>" };
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
    expect(() => parseServerEnv({ ...prod, APP_URL: "http://systelec.sn" })).toThrow(/APP_URL/);
    expect(() => parseServerEnv({ ...prod, APP_URL: "https://systelec.sn/" })).toThrow(/APP_URL/);
    expect(parseServerEnv({ ...prod, APP_URL: "https://systelec.sn" }).APP_URL).toBe("https://systelec.sn");
  });
});
