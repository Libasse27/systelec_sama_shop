import { execFileSync } from "node:child_process";
import { Client } from "pg";
import { E2E_DATABASE_NAME, E2E_STORAGE_DIR, resolveE2eDatabaseUrl } from "./support/database-guard";

/**
 * Prépare la base E2E dédiée (systelec_e2e, serveur de test) : identité vérifiée avant toute écriture,
 * création si absente (jamais de suppression), migrations, puis structure de base et données de
 * démonstration « [DÉMO] » (idempotent). La base de développement n'est jamais touchée.
 * Lancé par la commande du serveur web de Playwright, AVANT la construction (qui lit déjà la base).
 * Usage : pnpm exec tsx e2e/prepare-database.ts
 */
export async function prepareE2eDatabase(): Promise<void> {
  const databaseUrl = resolveE2eDatabaseUrl();
  await ensureDatabase(databaseUrl);
  await assertConnectedTo(databaseUrl);
  const env = { ...process.env, DATABASE_URL: databaseUrl, STORAGE_LOCAL_DIR: E2E_STORAGE_DIR };
  execFileSync("pnpm", ["exec", "prisma", "migrate", "deploy"], { stdio: "inherit", env });
  execFileSync("pnpm", ["-s", "db:seed"], { stdio: "inherit", env });
  execFileSync("pnpm", ["-s", "db:seed:demo"], { stdio: "inherit", env: { ...env, ALLOW_DEMO_SEED: "1" } });
}

/** Crée la base E2E si elle n'existe pas (base de maintenance « postgres » du même serveur). */
async function ensureDatabase(databaseUrl: string): Promise<void> {
  const maintenance = new URL(databaseUrl);
  maintenance.pathname = "/postgres";
  const client = new Client({ connectionString: maintenance.toString() });
  await client.connect();
  try {
    const { rowCount } = await client.query("SELECT 1 FROM pg_database WHERE datname = $1", [E2E_DATABASE_NAME]);
    if (rowCount === 0) await client.query(`CREATE DATABASE "${E2E_DATABASE_NAME}"`);
  } finally {
    await client.end();
  }
}

/** Identité confirmée par le serveur lui-même ; sinon les tests s'arrêtent. */
export async function assertConnectedTo(databaseUrl: string): Promise<void> {
  const client = new Client({ connectionString: databaseUrl });
  await client.connect();
  try {
    const { rows } = await client.query<{ name: string }>("SELECT current_database() AS name");
    if (rows[0]?.name !== E2E_DATABASE_NAME) throw new Error(`E2E : connecté à « ${rows[0]?.name} » au lieu de ${E2E_DATABASE_NAME}, arrêt.`);
  } finally {
    await client.end();
  }
}

if (process.argv[1]?.endsWith("prepare-database.ts")) {
  prepareE2eDatabase().catch((error: unknown) => {
    console.error(error instanceof Error ? error.message : error);
    process.exitCode = 1;
  });
}
