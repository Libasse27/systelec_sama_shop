import { describe, expect, it } from "vitest";
import { assertE2eDatabaseUrl } from "../../e2e/support/database-guard";

const dev = "postgresql://systelec:x@localhost:5433/systelec_dev";
const integration = "postgresql://systelec:x@localhost:5434/systelec_test";
const context = { devUrl: dev, integrationUrl: integration, appEnvs: ["development"] };

describe("isolation des E2E : base de test vérifiée avant toute écriture", () => {
  it("accepte seulement systelec_e2e, locale", () => {
    const url = "postgresql://systelec:x@localhost:5434/systelec_e2e";
    expect(assertE2eDatabaseUrl(url, context)).toBe(url);
  });

  it("refuse la base de développement, la base d'intégration et tout autre nom", () => {
    expect(() => assertE2eDatabaseUrl(dev, context)).toThrow(/systelec_e2e/);
    expect(() => assertE2eDatabaseUrl(integration, context)).toThrow(/systelec_e2e/);
    expect(() => assertE2eDatabaseUrl("postgresql://systelec:x@localhost:5434/systelec_e2e_old", context)).toThrow(/systelec_e2e/);
    // Même nom que la base de développement (configuration erronée) : refusé aussi.
    expect(() => assertE2eDatabaseUrl("postgresql://a:b@localhost:5433/systelec_e2e", { ...context, devUrl: "postgresql://a:b@localhost:5433/systelec_e2e" })).toThrow(
      /développement/,
    );
  });

  it("refuse une base distante, la production, une URL absente ou invalide", () => {
    expect(() => assertE2eDatabaseUrl("postgresql://a:b@db.example.sn:5432/systelec_e2e", context)).toThrow(/distante/);
    expect(() => assertE2eDatabaseUrl("postgresql://a:b@localhost:5434/systelec_e2e", { ...context, appEnvs: ["production"] })).toThrow(/production/);
    expect(() => assertE2eDatabaseUrl(undefined, context)).toThrow(/introuvable/);
    expect(() => assertE2eDatabaseUrl("pas une url", context)).toThrow(/invalide/);
    expect(() => assertE2eDatabaseUrl("mysql://a:b@localhost/systelec_e2e", context)).toThrow(/PostgreSQL/);
  });
});
