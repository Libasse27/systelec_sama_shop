import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { assertE2eRun, e2eDatabaseUser, e2eStoragePrefix } from "../../e2e/support/database-guard";

const runId = "c".repeat(24);
const user = e2eDatabaseUser(runId);
const env = {
  E2E_RUN_ID: runId,
  E2E_DATABASE_URL: `postgresql://${user}:secret@127.0.0.1:54321/systelec_e2e`,
  E2E_PORT: "41234",
  E2E_STORAGE_DIR: path.join(os.tmpdir(), `${e2eStoragePrefix(runId)}abc123`),
};

describe("isolation des E2E : exécution jetable vérifiée avant toute écriture", () => {
  it("accepte seulement les ressources créées pour l'exécution courante", () => {
    expect(assertE2eRun(env)).toEqual({ runId, databaseUrl: env.E2E_DATABASE_URL, port: 41234, storageDir: env.E2E_STORAGE_DIR });
  });

  it("refuse un lancement direct sans exécution isolée (playwright test sans le lanceur)", () => {
    expect(() => assertE2eRun({})).toThrow(/pnpm test:e2e/);
    expect(() => assertE2eRun({ ...env, E2E_RUN_ID: "pas-un-identifiant" })).toThrow(/identifiant/);
  });

  it.each([
    { E2E_DATABASE_URL: "postgresql://systelec:x@localhost:5433/systelec_dev" },
    { E2E_DATABASE_URL: "postgresql://systelec:x@localhost:5434/systelec_test" },
    { E2E_DATABASE_URL: "postgresql://systelec:x@localhost:5434/systelec_e2e" },
    { E2E_DATABASE_URL: `postgresql://${user}:secret@db.example.sn:54321/systelec_e2e` },
    { E2E_DATABASE_URL: `postgresql://e2e_${"d".repeat(12)}:secret@127.0.0.1:54321/systelec_e2e` },
    { E2E_DATABASE_URL: `postgresql://${user}@127.0.0.1:54321/systelec_e2e` },
    { E2E_DATABASE_URL: `postgresql://${user}:secret@127.0.0.1:54321/systelec_e2e_old` },
    { E2E_DATABASE_URL: `postgresql://${user}:secret@127.0.0.1:54321/systelec_e2e?host=/tmp` },
    { E2E_DATABASE_URL: `mysql://${user}:secret@127.0.0.1:54321/systelec_e2e` },
    { E2E_DATABASE_URL: "pas une url" },
  ])("refuse une base qui n'est pas le PostgreSQL jetable de l'exécution (%o)", (override) => {
    expect(() => assertE2eRun({ ...env, ...override })).toThrow(/E2E/);
  });

  it.each([
    { E2E_STORAGE_DIR: "./storage-e2e" },
    { E2E_STORAGE_DIR: "./storage" },
    { E2E_STORAGE_DIR: path.join(os.tmpdir(), `${e2eStoragePrefix("d".repeat(24))}abc123`) },
    { E2E_STORAGE_DIR: path.join(os.tmpdir(), "sous-dossier", `${e2eStoragePrefix(runId)}abc123`) },
  ])("refuse un dossier de fichiers qui n'est pas celui de l'exécution (%o)", (override) => {
    expect(() => assertE2eRun({ ...env, ...override })).toThrow(/dossier/);
  });

  it("refuse un port applicatif invalide et la production", () => {
    expect(() => assertE2eRun({ ...env, E2E_PORT: "80" })).toThrow(/port/);
    expect(() => assertE2eRun({ ...env, E2E_PORT: "54321" })).toThrow(/port/);
    expect(() => assertE2eRun({ ...env, APP_ENV: "production" })).toThrow(/production/);
    expect(() => assertE2eRun({ ...env, NODE_ENV: "production" })).toThrow(/production/);
  });
});
