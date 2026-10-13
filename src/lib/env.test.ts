import { describe, expect, it } from "vitest";
import { parseServerEnv } from "./env";

const DATABASE_URL = "postgresql://user:pass@localhost:5432/db";

describe("configuration serveur", () => {
  it("applique les valeurs par défaut en développement", () => {
    const env = parseServerEnv({ DATABASE_URL });
    expect(env.APP_ENV).toBe("development");
    expect(env.APP_URL).toBe("http://localhost:3000");
  });

  it("refuse une DATABASE_URL qui n'est pas PostgreSQL", () => {
    expect(() => parseServerEnv({ DATABASE_URL: "mysql://localhost/db" })).toThrow(/DATABASE_URL/);
  });

  it("exige en production une APP_URL explicite, en https, sans slash final", () => {
    const prod = { APP_ENV: "production", DATABASE_URL };
    expect(() => parseServerEnv(prod)).toThrow(/APP_URL/);
    expect(() => parseServerEnv({ ...prod, APP_URL: "http://systelec.sn" })).toThrow(/APP_URL/);
    expect(() => parseServerEnv({ ...prod, APP_URL: "https://systelec.sn/" })).toThrow(/APP_URL/);
    expect(parseServerEnv({ ...prod, APP_URL: "https://systelec.sn" }).APP_URL).toBe("https://systelec.sn");
  });
});
