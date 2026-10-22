import os from "node:os";
import path from "node:path";

/**
 * Isolation des tests E2E : ils écrivent (comptes, commandes, paramètres) dans leur base. Chaque exécution
 * a son PROPRE serveur PostgreSQL jetable (conteneur créé par e2e/run.ts, données en mémoire, port local
 * aléatoire, utilisateur et mot de passe aléatoires), son dossier de fichiers temporaire et son port
 * applicatif. Les tests ne visent jamais la base de développement, celle des tests d'intégration ni une
 * base de production. Toute incertitude interrompt les tests.
 */
export const E2E_DATABASE_NAME = "systelec_e2e";

/** Répertoire de build des E2E : jamais .next (développement, production locale). */
export const E2E_DIST_DIR = ".next-e2e";

/** Commentaire posé sur la base par le lanceur, relu avant toute écriture : preuve que c'est CETTE exécution. */
export const e2eRunMarker = (runId: string): string => `systelec-e2e-run:${runId}`;

export const e2eDatabaseUser = (runId: string): string => `e2e_${runId.slice(0, 12)}`;

export const e2eStoragePrefix = (runId: string): string => `systelec-e2e-${runId}-`;

export interface E2eRun {
  runId: string;
  databaseUrl: string;
  /** Port du serveur Next.js testé. */
  port: number;
  /** Dossier des fichiers téléversés, propre à l'exécution (dans le dossier temporaire du système). */
  storageDir: string;
}

const LAUNCH_HINT = "lancez les E2E avec « pnpm test:e2e » (base jetable créée pour l'exécution)";

const validPort = (value: number): boolean => Number.isInteger(value) && value >= 1024 && value <= 65535;

/**
 * Vérifie le contexte d'exécution transmis par e2e/run.ts AVANT toute connexion ; lève une erreur explicite
 * sinon : identifiant d'exécution, URL locale du serveur jetable (base systelec_e2e, utilisateur propre à
 * l'exécution), port applicatif, dossier de fichiers temporaire de l'exécution, environnement hors production.
 */
export function assertE2eRun(env: Readonly<Record<string, string | undefined>>): E2eRun {
  if (env.APP_ENV === "production" || env.NODE_ENV === "production") throw new Error("E2E : refus en environnement de production.");
  const runId = env.E2E_RUN_ID;
  if (!runId) throw new Error(`E2E : aucune exécution isolée en cours ; ${LAUNCH_HINT}.`);
  if (!/^[a-f0-9]{24}$/.test(runId)) throw new Error("E2E : identifiant d'exécution invalide.");

  let url: URL;
  try {
    url = new URL(env.E2E_DATABASE_URL ?? "");
  } catch {
    throw new Error(`E2E : URL de base absente ou invalide ; ${LAUNCH_HINT}.`);
  }
  const databasePort = Number(url.port);
  if (
    !["postgres:", "postgresql:"].includes(url.protocol) || url.hostname !== "127.0.0.1" || !validPort(databasePort) ||
    url.pathname !== `/${E2E_DATABASE_NAME}` || decodeURIComponent(url.username) !== e2eDatabaseUser(runId) || !url.password ||
    url.search !== "" || url.hash !== ""
  ) {
    throw new Error("E2E : refus, l'URL ne correspond pas au PostgreSQL jetable de cette exécution.");
  }

  const port = Number(env.E2E_PORT);
  if (!validPort(port) || port === databasePort) throw new Error("E2E : port applicatif invalide.");

  const storageDir = env.E2E_STORAGE_DIR ?? "";
  if (!path.isAbsolute(storageDir) || path.dirname(storageDir) !== os.tmpdir() || !path.basename(storageDir).startsWith(e2eStoragePrefix(runId))) {
    throw new Error("E2E : refus, le dossier de fichiers n'est pas le dossier temporaire de cette exécution.");
  }
  return { runId, databaseUrl: url.toString(), port, storageDir };
}

/** Contexte de l'exécution E2E en cours (variables posées par e2e/run.ts), toujours passé par assertE2eRun. */
export function resolveE2eRun(): E2eRun {
  return assertE2eRun(process.env);
}
