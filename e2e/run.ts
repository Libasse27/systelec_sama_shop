import { spawn } from "node:child_process";
import { randomBytes } from "node:crypto";
import { closeSync, mkdtempSync, openSync, readFileSync, rmSync, unlinkSync, writeSync } from "node:fs";
import { createServer } from "node:net";
import os from "node:os";
import path from "node:path";
import {
  createPasswordVolume,
  publishedPort,
  removeOwnContainer,
  removePasswordVolume,
  runPostgresContainer,
  waitUntilReady,
} from "../tests/setup/ephemeral-postgres";
import { assertE2eRun, E2E_DATABASE_NAME, E2E_DIST_DIR, e2eDatabaseUser, e2eStoragePrefix } from "./support/database-guard";
import { markRunDatabase, prepareE2eDatabase } from "./prepare-database";

/**
 * Lanceur des E2E (pnpm test:e2e [arguments de Playwright]) : chaque exécution crée SES ressources —
 * PostgreSQL jetable (conteneur étiqueté, données en mémoire, port local aléatoire, identifiants aléatoires),
 * dossier de fichiers temporaire, port applicatif libre — vérifie l'identité de la base avant toute
 * écriture, lance Playwright, puis ne supprime QUE ce qu'elle a créé (étiquette ou préfixe revérifiés).
 * Le build des E2E va dans .next-e2e (jamais .next) ; un verrou empêche deux exécutions de s'y écrire dessus.
 */

const BUILD_LOCK = `${E2E_DIST_DIR}.lock`;

interface LockOwner {
  pid: number;
  runId: string;
}

const isAlive = (pid: number): boolean => {
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    return (error as NodeJS.ErrnoException).code === "EPERM";
  }
};

function readLockOwner(): LockOwner | undefined {
  try {
    const owner = JSON.parse(readFileSync(BUILD_LOCK, "utf8")) as Partial<LockOwner>;
    return Number.isInteger(owner.pid) && typeof owner.runId === "string" ? (owner as LockOwner) : undefined;
  } catch {
    return undefined;
  }
}

/** Verrou du répertoire de build : refus si une autre exécution vivante le détient ; un verrou orphelin est repris. */
function acquireBuildLock(runId: string): void {
  for (let attempt = 0; attempt < 2; attempt += 1) {
    try {
      const fd = openSync(BUILD_LOCK, "wx");
      writeSync(fd, JSON.stringify({ pid: process.pid, runId } satisfies LockOwner));
      closeSync(fd);
      return;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error;
      const owner = readLockOwner();
      if (!owner) throw new Error(`E2E : verrou ${BUILD_LOCK} illisible ; vérifiez qu'aucune exécution E2E n'est en cours, puis supprimez-le.`);
      if (isAlive(owner.pid)) throw new Error(`E2E : une autre exécution (processus ${owner.pid}) utilise ${E2E_DIST_DIR} ; attendez sa fin.`);
      console.warn(`E2E : verrou orphelin de l'exécution ${owner.runId} (processus ${owner.pid} terminé), repris.`);
      unlinkSync(BUILD_LOCK);
    }
  }
  throw new Error(`E2E : impossible de prendre le verrou ${BUILD_LOCK}.`);
}

function releaseBuildLock(runId: string): void {
  if (readLockOwner()?.runId === runId) unlinkSync(BUILD_LOCK);
}

/** Port TCP libre sur la machine, choisi par le système. */
function freePort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const server = createServer();
    server.once("error", reject);
    server.listen(0, () => {
      const address = server.address();
      server.close(() => (typeof address === "object" && address ? resolve(address.port) : reject(new Error("E2E : aucun port libre."))));
    });
  });
}

let child: ReturnType<typeof spawn> | undefined;
let interrupted = false;

function onSignal(signal: NodeJS.Signals): void {
  interrupted = true;
  // Ctrl+C atteint déjà Playwright (même groupe de processus) ; un SIGTERM ne vise que ce lanceur.
  if (signal === "SIGTERM") child?.kill("SIGTERM");
}

function runPlaywright(args: string[], env: NodeJS.ProcessEnv): Promise<number> {
  return new Promise((resolve, reject) => {
    child = spawn("pnpm", ["exec", "playwright", "test", ...args], { stdio: "inherit", env });
    child.once("error", reject);
    child.once("exit", (code, signal) => resolve(code ?? (signal ? 1 : 0)));
  });
}

const checkInterrupted = (): void => {
  if (interrupted) throw new Error("E2E : exécution interrompue.");
};

async function main(): Promise<number> {
  if (process.env.APP_ENV === "production" || process.env.NODE_ENV === "production") throw new Error("E2E : refus en environnement de production.");
  const runId = randomBytes(12).toString("hex");
  const user = e2eDatabaseUser(runId);
  const password = randomBytes(24).toString("hex");
  const containerName = `systelec-e2e-${runId}`;
  const secretVolume = `systelec-e2esecret-${runId}`;
  console.log(`E2E : exécution ${runId} (conteneur ${containerName}).`);

  acquireBuildLock(runId);
  try {
    createPasswordVolume(secretVolume, runId, password);
    let containerId: string | undefined;
    let storageDir: string | undefined;
    try {
      containerId = runPostgresContainer({ name: containerName, runId, user, database: E2E_DATABASE_NAME, secretVolume });
      const databasePort = await publishedPort(containerId, runId, containerName);
      const databaseUrl = `postgresql://${user}:${password}@127.0.0.1:${databasePort}/${E2E_DATABASE_NAME}`;
      await waitUntilReady(databaseUrl, containerId);
      checkInterrupted();
      storageDir = mkdtempSync(path.join(os.tmpdir(), e2eStoragePrefix(runId)));
      const env: NodeJS.ProcessEnv = {
        ...process.env,
        E2E_RUN_ID: runId,
        E2E_DATABASE_URL: databaseUrl,
        E2E_PORT: String(await freePort()),
        E2E_STORAGE_DIR: storageDir,
      };
      const run = assertE2eRun(env);
      await markRunDatabase(run);
      await prepareE2eDatabase(run);
      checkInterrupted();
      return await runPlaywright(process.argv.slice(2), env);
    } finally {
      try {
        if (storageDir && path.dirname(storageDir) === os.tmpdir() && path.basename(storageDir).startsWith(e2eStoragePrefix(runId))) {
          rmSync(storageDir, { recursive: true, force: true });
        }
      } finally {
        try {
          if (containerId) removeOwnContainer(containerId, runId);
        } finally {
          removePasswordVolume(secretVolume, runId);
        }
      }
    }
  } finally {
    releaseBuildLock(runId);
  }
}

process.on("SIGINT", onSignal);
process.on("SIGTERM", onSignal);
main().then(
  (code) => {
    process.exitCode = code;
  },
  (error: unknown) => {
    console.error(error instanceof Error ? error.message : error);
    process.exitCode = 1;
  },
);
