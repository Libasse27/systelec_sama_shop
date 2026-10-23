import { execFileSync } from "node:child_process";
import { Client } from "pg";
import { E2E_DATABASE_NAME, e2eDatabaseUser, e2eRunMarker, type E2eRun } from "./support/database-guard";

/**
 * Prépare la base E2E de l'exécution (serveur jetable créé par e2e/run.ts) : identité vérifiée avant toute
 * écriture, migrations, puis structure de base et données de démonstration « [DÉMO] ».
 * Appelé par le lanceur AVANT la construction (qui lit déjà la base).
 */
export async function prepareE2eDatabase(run: E2eRun): Promise<void> {
  await assertRunDatabase(run);
  const env = { ...process.env, DATABASE_URL: run.databaseUrl, STORAGE_LOCAL_DIR: run.storageDir };
  execFileSync("pnpm", ["exec", "prisma", "migrate", "deploy"], { stdio: "inherit", env });
  execFileSync("pnpm", ["-s", "db:seed"], { stdio: "inherit", env });
  execFileSync("pnpm", ["-s", "db:seed:demo"], { stdio: "inherit", env: { ...env, ALLOW_DEMO_SEED: "1" } });
}

async function withClient<T>(databaseUrl: string, query: (client: Client) => Promise<T>): Promise<T> {
  const client = new Client({ connectionString: databaseUrl });
  await client.connect();
  try {
    return await query(client);
  } finally {
    await client.end();
  }
}

/** Marque la base fraîchement créée comme appartenant à CETTE exécution (identifiant validé : 24 caractères hexadécimaux). */
export async function markRunDatabase(run: E2eRun): Promise<void> {
  if (!/^[a-f0-9]{24}$/.test(run.runId)) throw new Error("E2E : identifiant d'exécution invalide.");
  await withClient(run.databaseUrl, (client) => client.query(`COMMENT ON DATABASE "${E2E_DATABASE_NAME}" IS '${e2eRunMarker(run.runId)}'`));
}

/** Identité confirmée par le serveur lui-même (base, utilisateur, marque de l'exécution) ; sinon les tests s'arrêtent. */
export async function assertRunDatabase(run: E2eRun): Promise<void> {
  const row = await withClient(run.databaseUrl, async (client) => {
    const { rows } = await client.query<{ name: string; user: string; marker: string | null }>(
      `SELECT current_database() AS name, current_user AS user, shobj_description(d.oid, 'pg_database') AS marker
       FROM pg_database d WHERE d.datname = current_database()`,
    );
    return rows[0];
  });
  if (row?.name !== E2E_DATABASE_NAME || row.user !== e2eDatabaseUser(run.runId) || row.marker !== e2eRunMarker(run.runId)) {
    throw new Error("E2E : la base connectée n'est pas celle créée pour cette exécution, arrêt.");
  }
}
