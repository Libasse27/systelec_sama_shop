import { randomBytes } from "node:crypto";
import os from "node:os";
import path from "node:path";
import { Client } from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { assertE2eRun, E2E_DATABASE_NAME, e2eRunMarker, type E2eRun } from "../../e2e/support/database-guard";
import { runWithCleanup, type CleanupStep } from "../../e2e/support/cleanup";
import { startRunDatabase, type RunDatabase } from "../../e2e/support/run-database";
import { assertRunDatabase, markRunDatabase } from "../../e2e/prepare-database";
import { docker, publishedPort, removeOwnContainer, removePasswordVolume } from "../setup/ephemeral-postgres";

/**
 * Protections de la base E2E vérifiées contre de VRAIS serveurs PostgreSQL jetables : deux exécutions (A et B),
 * chacune avec son conteneur étiqueté, son volume secret et ses identifiants aléatoires, créés par le même
 * code que le lanceur (e2e/support/run-database.ts). Aucune autre base n'est contactée : les URL viennent
 * exclusivement de ces conteneurs (127.0.0.1, port aléatoire). Docker requis (comme le projet « migration »).
 */

const RUN_LABEL = "systelec.migration-test.run";

interface Started {
  database: RunDatabase;
  run: E2eRun;
}

/** `cleanups` reçoit chaque ressource dès sa création (fourni par l'appelant : conservé même si le démarrage échoue). */
async function startRun(runId: string, cleanups: CleanupStep[]): Promise<Started> {
  const database = await startRunDatabase(runId, (step) => cleanups.push(step));
  const run = assertE2eRun({
    E2E_RUN_ID: runId,
    E2E_DATABASE_URL: database.databaseUrl,
    E2E_PORT: "41234",
    E2E_STORAGE_DIR: path.join(os.tmpdir(), `systelec-e2e-${runId}-garde`),
  });
  return { database, run };
}

const query = async (url: string, sql: string): Promise<void> => {
  const client = new Client({ connectionString: url });
  await client.connect();
  try {
    await client.query(sql);
  } finally {
    await client.end();
  }
};

const withPassword = (url: string, password: string): string => {
  const parsed = new URL(url);
  parsed.password = password;
  return parsed.toString();
};

const exists = (kind: "container" | "volume", name: string): boolean => {
  try {
    docker([kind, "inspect", name]);
    return true;
  } catch {
    return false;
  }
};

describe("isolation des E2E : protections vérifiées sur des PostgreSQL jetables réels", () => {
  const runIdA = randomBytes(12).toString("hex");
  const runIdB = randomBytes(12).toString("hex");
  const cleanupsA: CleanupStep[] = [];
  const cleanupsB: CleanupStep[] = [];
  let a: Started;
  let b: Started;

  beforeAll(async () => {
    a = await startRun(runIdA, cleanupsA);
    b = await startRun(runIdB, cleanupsB);
  });

  afterAll(async () => {
    await runWithCleanup(async (defer) => [...cleanupsA, ...cleanupsB].forEach(defer));
    for (const runId of [runIdA, runIdB]) {
      expect(docker(["ps", "-a", "--filter", `label=${RUN_LABEL}=${runId}`, "-q"])).toBe("");
      expect(docker(["volume", "ls", "--filter", `label=${RUN_LABEL}=${runId}`, "-q"])).toBe("");
    }
  });

  it("conteneur d'une autre exécution, ou étiquette/nom incorrects : refusé", async () => {
    await expect(publishedPort(a.database.containerId, runIdB, a.database.containerName)).rejects.toThrow(/ne correspond pas à cette exécution/);
    await expect(publishedPort(a.database.containerId, runIdA, b.database.containerName)).rejects.toThrow(/ne correspond pas à cette exécution/);
    await expect(publishedPort(a.database.containerId, runIdA, a.database.containerName)).resolves.toBe(Number(new URL(a.run.databaseUrl).port));
  });

  it("marqueur absent : refusé avant toute écriture", async () => {
    await expect(assertRunDatabase(a.run)).rejects.toThrow(/n'est pas celle créée pour cette exécution/);
  });

  it("marqueur d'une autre exécution : refusé ; marqueur de l'exécution : accepté", async () => {
    await query(a.run.databaseUrl, `COMMENT ON DATABASE "${E2E_DATABASE_NAME}" IS '${e2eRunMarker(runIdB)}'`);
    await expect(assertRunDatabase(a.run)).rejects.toThrow(/n'est pas celle créée pour cette exécution/);
    await markRunDatabase(a.run);
    await expect(assertRunDatabase(a.run)).resolves.toBeUndefined();
  });

  it("identifiants PostgreSQL invalides : connexion refusée par le serveur", async () => {
    await expect(assertRunDatabase({ ...a.run, databaseUrl: withPassword(a.run.databaseUrl, "mauvais") })).rejects.toMatchObject({ code: "28P01" });
    // Identifiants de B présentés au serveur de A : l'utilisateur de B n'y existe pas.
    const bOnA = new URL(b.run.databaseUrl);
    bOnA.port = new URL(a.run.databaseUrl).port;
    await expect(assertRunDatabase({ ...b.run, databaseUrl: bOnA.toString() })).rejects.toMatchObject({ code: "28P01" });
  });

  it("serveur de B marqué par B mais présenté comme l'exécution A : refusé (utilisateur et marqueur)", async () => {
    await markRunDatabase(b.run);
    await expect(assertRunDatabase({ ...a.run, databaseUrl: b.run.databaseUrl })).rejects.toThrow(/n'est pas celle créée pour cette exécution/);
  });

  it("suppression du conteneur ou du volume d'une autre exécution : refusée, ressources intactes", () => {
    expect(() => removeOwnContainer(b.database.containerId, runIdA)).toThrow(/n'a pas été créé par cette exécution/);
    expect(() => removePasswordVolume(b.database.secretVolume, runIdA)).toThrow(/n'appartient pas à cette exécution/);
    expect(exists("container", b.database.containerId)).toBe(true);
    expect(exists("volume", b.database.secretVolume)).toBe(true);
  });
});
