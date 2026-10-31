import { execFileSync } from "node:child_process";
import { randomBytes } from "node:crypto";
import { mkdtempSync, rmSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { Client } from "pg";
import type { TestProject } from "vitest/node";
import { assertDisposableTestDatabase } from "./test-database";

/**
 * Serveur PostgreSQL JETABLE pour les tests de migration (projet Vitest « migration ») : un conteneur
 * créé pour cette exécution, données en mémoire, port local aléatoire, identifiants aléatoires. Aucune
 * base existante (développement, test partagée, production) n'est jamais contactée. À la fin, seul le
 * conteneur créé ici est supprimé : identifié par l'identifiant rendu à sa création et par l'étiquette
 * propre à cette exécution.
 */

/** Même image que la production (docker-compose.prod.yml), épinglée par empreinte. */
const POSTGRES_IMAGE = "postgres:17.11-alpine@sha256:b0f9560a2de083e2cc7382e75f808c7381a32852a7ec49117deedb300e552b24";
const RUN_LABEL = "systelec.migration-test.run";
const READY_TIMEOUT_MS = 60_000;
const READY_POLL_MS = 500;

export interface MigrationDatabase {
  url: string;
  database: string;
  user: string;
  port: number;
  runId: string;
}

export interface IntegrationDatabase {
  url: string;
  database: string;
  user: string;
  port: number;
  runId: string;
  containerId: string;
  containerLabel: string;
  storageDirectory: string;
}

declare module "vitest" {
  export interface ProvidedContext {
    migrationDatabase: MigrationDatabase;
    integrationDatabase: IntegrationDatabase;
  }
}

export const docker = (args: string[], input?: string): string => execFileSync("docker", args, {
  encoding: "utf8",
  ...(input === undefined ? { stdio: ["ignore", "pipe", "pipe"] as const } : { input, stdio: ["pipe", "pipe", "pipe"] as const }),
}).trim();

export async function publishedPort(containerId: string, runId: string, expectedName: string): Promise<number> {
  const deadline = Date.now() + 10_000;
  for (;;) {
    const info = JSON.parse(docker(["inspect", "--format", "{{json .}}", containerId])) as {
      Id: string;
      Name: string;
      Config: { Labels?: Record<string, string> };
      NetworkSettings: { Ports?: Record<string, Array<{ HostIp: string; HostPort: string }> | null> };
    };
    const binding = info.NetworkSettings.Ports?.["5432/tcp"]?.[0];
    if (info.Id !== containerId || info.Name !== `/${expectedName}` || info.Config.Labels?.[RUN_LABEL] !== runId) {
      throw new Error("Le conteneur PostgreSQL ne correspond pas à cette exécution.");
    }
    if (binding?.HostIp === "127.0.0.1") {
      const port = Number(binding.HostPort);
      if (!Number.isInteger(port) || port <= 0 || port > 65535) throw new Error("Port du PostgreSQL jetable invalide.");
      return port;
    }
    if (Date.now() > deadline) throw new Error(`Port local du PostgreSQL jetable non publié avant expiration du délai (${JSON.stringify(info.NetworkSettings.Ports)}).`);
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
}

/** Attend que le serveur accepte les connexions TCP (après son initialisation, qui redémarre une fois). */
export async function waitUntilReady(url: string, containerId: string): Promise<void> {
  const deadline = Date.now() + READY_TIMEOUT_MS;
  for (;;) {
    const client = new Client({ connectionString: url });
    try {
      await client.connect();
      await client.query("SELECT 1");
      return;
    } catch {
      if (Date.now() > deadline) {
        const logs = docker(["logs", containerId]);
        throw new Error(`PostgreSQL jetable non prêt avant expiration du délai. Logs du conteneur : ${logs.slice(-2000)}`);
      }
      await new Promise((resolve) => setTimeout(resolve, READY_POLL_MS));
    } finally {
      await client.end().catch(() => undefined);
    }
  }
}

/** Supprime le conteneur seulement s'il porte l'étiquette de CETTE exécution. */
export function removeOwnContainer(containerId: string, runId: string): void {
  const label = docker(["inspect", "--format", `{{ index .Config.Labels "${RUN_LABEL}" }}`, containerId]);
  if (label !== runId) throw new Error(`Refus de supprimer le conteneur ${containerId} : il n'a pas été créé par cette exécution.`);
  docker(["rm", "--force", "--volumes", containerId]);
}

/** Stocke le secret dans un volume privé, sans valeur ni chemin hôte dans la ligne de commande. */
export function createPasswordVolume(volume: string, runId: string, password: string): void {
  docker(["volume", "create", "--label", `${RUN_LABEL}=${runId}`, volume]);
  try {
    docker([
      "run", "--rm", "-i",
      "--mount", `type=volume,source=${volume},target=/run/secrets`,
      "--entrypoint", "/bin/sh",
      POSTGRES_IMAGE,
      "-c", "umask 077; cat > /run/secrets/password; chmod 400 /run/secrets/password",
    ], password);
  } catch {
    removePasswordVolume(volume, runId);
    throw new Error("Impossible de préparer le secret temporaire PostgreSQL.");
  }
}

export function removePasswordVolume(volume: string, runId: string): void {
  const label = docker(["volume", "inspect", "--format", `{{ index .Labels "${RUN_LABEL}" }}`, volume]);
  if (label !== runId) throw new Error("Refus de supprimer le volume secret : il n'appartient pas à cette exécution.");
  docker(["volume", "rm", volume]);
}

/** Démarre le conteneur de CETTE exécution (étiqueté, données en mémoire, port local aléatoire) ; rend son identifiant. */
export function runPostgresContainer(options: { name: string; runId: string; user: string; database: string; secretVolume: string }): string {
  return docker([
    "run", "--detach",
    "--name", options.name,
    "--label", `${RUN_LABEL}=${options.runId}`,
    "--env", `POSTGRES_USER=${options.user}`,
    "--env", `POSTGRES_DB=${options.database}`,
    "--mount", `type=volume,source=${options.secretVolume},target=/run/secrets,readonly`,
    "--tmpfs", "/var/lib/postgresql/data",
    "--publish", "127.0.0.1::5432",
    "--entrypoint", "/bin/sh",
    POSTGRES_IMAGE,
    "-c", "export POSTGRES_PASSWORD=\"$(cat /run/secrets/password)\"; exec docker-entrypoint.sh postgres",
  ]);
}

export default async function setup(project: TestProject): Promise<() => void> {
  const runId = randomBytes(12).toString("hex");
  const database = `migtest_${runId}`;
  const user = `migtest_${runId.slice(0, 8)}`;
  const password = randomBytes(24).toString("hex");
  const secretVolume = `systelec-migsecret-${runId}`;
  createPasswordVolume(secretVolume, runId, password);
  let containerId: string | undefined;
  try {
    containerId = runPostgresContainer({ name: `systelec-migtest-${runId}`, runId, user, database, secretVolume });
    const port = await publishedPort(containerId, runId, `systelec-migtest-${runId}`);
    const url = `postgresql://${user}:${password}@127.0.0.1:${port}/${database}`;
    await waitUntilReady(url, containerId);
    project.provide("migrationDatabase", { url, database, user, port, runId });
  } catch (error) {
    try {
      if (containerId) removeOwnContainer(containerId, runId);
    } finally {
      removePasswordVolume(secretVolume, runId);
    }
    throw error;
  }
  if (!containerId) throw new Error("Le conteneur PostgreSQL jetable n'a pas été créé.");
  return () => {
    try {
      removeOwnContainer(containerId, runId);
    } finally {
      removePasswordVolume(secretVolume, runId);
    }
  };
}

/** Démarre une instance séparée pour les tests d'intégration, avec un nom de base connu et strictement local. */
export async function startIntegrationDatabase(project: TestProject): Promise<() => void> {
  const runId = randomBytes(12).toString("hex");
  const database = "systelec_test";
  const user = `it_${runId.slice(0, 12)}`;
  const password = randomBytes(24).toString("hex");
  const containerLabel = runId;
  const secretVolume = `systelec-itsecret-${runId}`;
  createPasswordVolume(secretVolume, runId, password);
  let storageDirectory: string | undefined;
  let containerId: string | undefined;
  try {
    containerId = runPostgresContainer({ name: `systelec-it-${runId}`, runId, user, database, secretVolume });
    const port = await publishedPort(containerId, runId, `systelec-it-${runId}`);
    const url = `postgresql://${user}:${password}@127.0.0.1:${port}/${database}`;
    await waitUntilReady(url, containerId);
    const integrationStorageDirectory = mkdtempSync(path.join(os.tmpdir(), `systelec-integration-${runId}-`));
    storageDirectory = integrationStorageDirectory;
    const provided = { url, database, user, port, runId, containerId, containerLabel, storageDirectory: integrationStorageDirectory };
    assertDisposableTestDatabase(provided);
    const env = { PATH: process.env.PATH ?? "", HOME: process.env.HOME ?? "", NODE_ENV: "test" as const, DATABASE_URL: url };
    execFileSync("pnpm", ["exec", "prisma", "migrate", "deploy"], { env, stdio: "inherit" });
    project.provide("integrationDatabase", provided);
  } catch (error) {
    try {
      if (storageDirectory) rmSync(storageDirectory, { recursive: true, force: true });
    } finally {
      try {
        if (containerId) removeOwnContainer(containerId, runId);
      } finally {
        removePasswordVolume(secretVolume, runId);
      }
    }
    throw error;
  }
  if (!containerId) throw new Error("Le conteneur PostgreSQL jetable n'a pas été créé.");
  return () => {
    try {
      if (storageDirectory && path.basename(storageDirectory).startsWith(`systelec-integration-${runId}-`)) {
        rmSync(storageDirectory, { recursive: true, force: true });
      }
    } finally {
      try {
        removeOwnContainer(containerId, runId);
      } finally {
        removePasswordVolume(secretVolume, runId);
      }
    }
  };
}
