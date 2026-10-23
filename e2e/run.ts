import { spawn } from "node:child_process";
import { randomBytes } from "node:crypto";
import { mkdtempSync, rmSync } from "node:fs";
import { createServer } from "node:net";
import os from "node:os";
import path from "node:path";
import { acquireBuildLock, recordLockChild, releaseBuildLock } from "./support/build-lock";
import { failureLines, runWithCleanup } from "./support/cleanup";
import { assertE2eRun, E2E_DIST_DIR, e2eStoragePrefix } from "./support/database-guard";
import { restoreNextEnv, snapshotNextEnv } from "./support/next-env";
import { startRunDatabase } from "./support/run-database";
import { markRunDatabase, prepareE2eDatabase } from "./prepare-database";

/**
 * Lanceur des E2E (pnpm test:e2e [arguments de Playwright]) : chaque exécution crée SES ressources —
 * PostgreSQL jetable (conteneur étiqueté, données en mémoire, port local aléatoire, identifiants aléatoires),
 * dossier de fichiers temporaire, port applicatif libre — vérifie l'identité de la base avant toute
 * écriture, lance Playwright, puis ne supprime QUE ce qu'elle a créé (étiquette ou préfixe revérifiés).
 * Le build des E2E va dans .next-e2e (jamais .next) ; un verrou empêche deux exécutions de s'y écrire dessus,
 * et next-env.d.ts, réécrit par ce build, est rétabli à la fin.
 */

const BUILD_LOCK = `${E2E_DIST_DIR}.lock`;
const NEXT_ENV_FILE = "next-env.d.ts";

/** Port TCP libre sur l'interface locale, choisi par le système. */
function freePort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const server = createServer();
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => {
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

function runPlaywright(args: string[], env: NodeJS.ProcessEnv, runId: string): Promise<number> {
  return new Promise((resolve, reject) => {
    child = spawn("pnpm", ["exec", "playwright", "test", ...args], { stdio: "inherit", env });
    child.once("error", reject);
    child.once("exit", (code, signal) => resolve(code ?? (signal ? 1 : 0)));
    // Si ce lanceur est tué seul, Playwright (et son build) continue : le verrou reste détenu par lui.
    if (child.pid) {
      try {
        recordLockChild(BUILD_LOCK, runId, child.pid);
      } catch (error) {
        console.warn(`E2E : processus Playwright non enregistré dans le verrou (${(error as Error).message}).`);
      }
    }
  });
}

const checkInterrupted = (): void => {
  if (interrupted) throw new Error("E2E : exécution interrompue.");
};

async function main(): Promise<number> {
  if (process.env.APP_ENV === "production" || process.env.NODE_ENV === "production") throw new Error("E2E : refus en environnement de production.");
  const runId = randomBytes(12).toString("hex");
  console.log(`E2E : exécution ${runId}.`);

  return runWithCleanup(async (defer) => {
    acquireBuildLock(BUILD_LOCK, { pid: process.pid, runId });
    defer({ label: `verrou ${BUILD_LOCK}`, run: () => releaseBuildLock(BUILD_LOCK, runId) });
    const nextEnv = snapshotNextEnv(NEXT_ENV_FILE);
    defer({
      label: NEXT_ENV_FILE,
      run: () => {
        if (restoreNextEnv(NEXT_ENV_FILE, nextEnv, E2E_DIST_DIR) === "conservé") {
          console.warn(`E2E : ${NEXT_ENV_FILE} modifié pendant l'exécution par un autre outil ; laissé tel quel.`);
        }
      },
    });

    const { databaseUrl } = await startRunDatabase(runId, defer);
    checkInterrupted();
    const storageDir = mkdtempSync(path.join(os.tmpdir(), e2eStoragePrefix(runId)));
    defer({
      label: `dossier ${storageDir}`,
      run: () => {
        if (path.dirname(storageDir) === os.tmpdir() && path.basename(storageDir).startsWith(e2eStoragePrefix(runId))) {
          rmSync(storageDir, { recursive: true, force: true });
        }
      },
    });

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
    return runPlaywright(process.argv.slice(2), env, runId);
  });
}

process.on("SIGINT", onSignal);
process.on("SIGTERM", onSignal);
main().then(
  (code) => {
    process.exitCode = code;
  },
  (error: unknown) => {
    for (const line of failureLines(error)) console.error(line);
    process.exitCode = 1;
  },
);
