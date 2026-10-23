import { createInterface } from "node:readline";
import { acquireBuildLock } from "../../e2e/support/build-lock";

/**
 * Processus concurrent pour tests/policy/e2e-build-lock.test.ts : annonce « prêt », attend « go » sur l'entrée
 * standard, tente de prendre le verrou, écrit le résultat, puis reste vivant (verrou tenu) jusqu'à la fermeture
 * de l'entrée standard.
 */
const [lockPath, runId] = process.argv.slice(2);
if (!lockPath || !runId) throw new Error("usage : e2e-lock-contender <verrou> <exécution>");
const lines = createInterface({ input: process.stdin });

lines.on("line", (line) => {
  if (line !== "go") return;
  try {
    acquireBuildLock(lockPath, { pid: process.pid, runId });
    process.stdout.write(`${JSON.stringify({ runId, ok: true })}\n`);
  } catch (error) {
    process.stdout.write(`${JSON.stringify({ runId, ok: false, error: (error as Error).message })}\n`);
  }
});
lines.on("close", () => process.exit(0));
process.stdout.write("prêt\n");
