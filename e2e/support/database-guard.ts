import { parse } from "dotenv";
import { existsSync, readFileSync } from "node:fs";

/**
 * Isolation des tests E2E : ils écrivent (comptes, commandes, paramètres) dans leur base. Ils ne
 * doivent JAMAIS viser la base de développement, celle des tests d'intégration (vidée entre deux
 * tests) ni une base de production. Base dédiée : systelec_e2e, sur le serveur PostgreSQL de test
 * (docker compose, service db-test). Toute incertitude interrompt les tests.
 */
export const E2E_DATABASE_NAME = "systelec_e2e";

/** Hôtes acceptés : la base E2E est locale (conteneur de test), jamais distante. */
const LOCAL_HOSTS = new Set(["localhost", "127.0.0.1", "::1", "[::1]"]);

export interface GuardContext {
  /** Base de développement (.env) et base d'intégration (.env.test), si connues. */
  devUrl?: string;
  integrationUrl?: string;
  /** APP_ENV effectif du processus et de .env. */
  appEnvs: readonly (string | undefined)[];
}

const databaseOf = (url: string): string => decodeURIComponent(new URL(url).pathname.replace(/^\//, ""));
const serverOf = (url: string): string => {
  const parsed = new URL(url);
  return `${parsed.hostname}:${parsed.port || "5432"}`;
};
const sameDatabase = (a: string, b: string): boolean => serverOf(a) === serverOf(b) && databaseOf(a) === databaseOf(b);

/**
 * Vérifie l'URL de la base E2E AVANT toute connexion ; lève une erreur explicite sinon :
 * nom exact systelec_e2e, hôte local, différente des bases de développement et d'intégration,
 * environnement qui n'est pas la production.
 */
export function assertE2eDatabaseUrl(url: string | undefined, context: GuardContext): string {
  if (!url) throw new Error("E2E : base de test introuvable (E2E_DATABASE_URL ou DATABASE_URL de .env.test).");
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    throw new Error("E2E : URL de base invalide.");
  }
  if (!/^postgres(ql)?:$/.test(parsed.protocol)) throw new Error("E2E : la base doit être PostgreSQL.");
  if (context.appEnvs.includes("production")) throw new Error("E2E : refus en environnement de production.");
  if (!LOCAL_HOSTS.has(parsed.hostname)) throw new Error(`E2E : refus d'une base distante (${parsed.hostname}).`);
  if (databaseOf(url) !== E2E_DATABASE_NAME) throw new Error(`E2E : la base doit s'appeler ${E2E_DATABASE_NAME} (reçu : ${databaseOf(url) || "vide"}).`);
  if (context.devUrl && sameDatabase(url, context.devUrl)) throw new Error("E2E : refus, c'est la base de développement.");
  if (context.integrationUrl && sameDatabase(url, context.integrationUrl)) throw new Error("E2E : refus, c'est la base des tests d'intégration.");
  return url;
}

function readEnvFile(path: string): Record<string, string> {
  return existsSync(path) ? parse(readFileSync(path)) : {};
}

/**
 * URL de la base E2E : E2E_DATABASE_URL si fournie, sinon le serveur de .env.test avec la base
 * systelec_e2e. Toujours passée par assertE2eDatabaseUrl.
 */
export function resolveE2eDatabaseUrl(): string {
  const dev = readEnvFile(".env");
  const integration = readEnvFile(".env.test");
  const fromIntegration = (() => {
    if (!integration.DATABASE_URL) return undefined;
    const url = new URL(integration.DATABASE_URL);
    url.pathname = `/${E2E_DATABASE_NAME}`;
    return url.toString();
  })();
  return assertE2eDatabaseUrl(process.env.E2E_DATABASE_URL ?? fromIntegration, {
    devUrl: dev.DATABASE_URL,
    integrationUrl: integration.DATABASE_URL,
    appEnvs: [process.env.APP_ENV, dev.APP_ENV, process.env.NODE_ENV === "production" ? "production" : undefined],
  });
}

/** Dossier des fichiers téléversés pendant les E2E (jamais celui du développement). */
export const E2E_STORAGE_DIR = "./storage-e2e";
