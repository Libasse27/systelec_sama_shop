import { execFileSync } from "node:child_process";
import { mkdtempSync, mkdirSync, readdirSync, cpSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { Client } from "pg";
import { afterAll, beforeAll, describe, expect, inject, it } from "vitest";

/**
 * Migration 20261019090000_notification_retries : atomicité démontrée avec le vrai `prisma migrate deploy`.
 * Projet Vitest « migration » : serveur PostgreSQL JETABLE créé pour cette exécution
 * (tests/setup/ephemeral-postgres.ts), jamais la base de test partagée ni aucune autre.
 */
const TARGET = "20261019090000_notification_retries";
const ROOT = process.cwd();
const MIGRATIONS = path.join(ROOT, "prisma", "migrations");
const target = inject("migrationDatabase");
let workDir: string | undefined;

/** Gardes : hôte local, port, base et utilisateur fournis par le serveur jetable de cette exécution. */
function assertDisposableUrl(value: string): string {
  const url = new URL(value);
  const expected = { hostname: "127.0.0.1", port: String(target.port), pathname: `/${target.database}`, username: target.user };
  const actual = { hostname: url.hostname, port: url.port, pathname: url.pathname, username: url.username };
  if (
    !["postgres:", "postgresql:"].includes(url.protocol) ||
    JSON.stringify(actual) !== JSON.stringify(expected) ||
    !url.password ||
    [...url.searchParams.keys()].length > 0 ||
    !/^[a-f0-9]{24}$/.test(target.runId) ||
    target.database !== `migtest_${target.runId}` ||
    target.user !== `migtest_${target.runId.slice(0, 8)}`
  ) {
    throw new Error("Refus : l'URL ne désigne pas le PostgreSQL jetable de cette exécution.");
  }
  return value;
}

/** Dossier de migrations et configuration Prisma propres à ce test (avec ou sans la migration visée). */
function prepareConfig(name: string, withTarget: boolean): string {
  if (!workDir) throw new Error("Répertoire de travail isolé absent.");
  const dir = path.join(workDir, name);
  mkdirSync(dir, { recursive: true });
  for (const entry of readdirSync(MIGRATIONS)) {
    if (withTarget || entry !== TARGET) cpSync(path.join(MIGRATIONS, entry), path.join(dir, entry), { recursive: true });
  }
  const config = path.join(workDir, `${name}.config.ts`);
  writeFileSync(
    config,
    `import { defineConfig } from "prisma/config";
export default defineConfig({
  schema: ${JSON.stringify(path.join(ROOT, "prisma", "schema.prisma"))},
  migrations: { path: ${JSON.stringify(dir)} },
  datasource: { url: process.env.MIGRATION_TEST_DATABASE_URL! },
});
`,
  );
  return config;
}

/** Prisma CLI avec un environnement minimal : aucune autre URL de base n'est transmise. */
function prisma(config: string, ...args: string[]): { ok: boolean; output: string } {
  const url = assertDisposableUrl(target.url);
  const env = { NODE_ENV: "test" as const, PATH: process.env.PATH ?? "", HOME: process.env.HOME ?? "", MIGRATION_TEST_DATABASE_URL: url };
  try {
    return { ok: true, output: execFileSync("pnpm", ["exec", "prisma", ...args, "--config", config], { env, encoding: "utf8", stdio: "pipe" }) };
  } catch (error) {
    const failed = error as { stdout?: string; stderr?: string };
    return { ok: false, output: `${failed.stdout ?? ""}${failed.stderr ?? ""}` };
  }
}

let scratch: Client;
const one = async <T>(sql: string): Promise<T> => (await scratch.query(sql)).rows[0] as T;
const schemaState = () =>
  one<{ columns: string; constraints: string; indexes: string }>(`
    SELECT
      (SELECT count(*) FROM information_schema.columns WHERE table_name = 'notifications' AND column_name IN ('attempts', 'nextAttemptAt')) AS columns,
      (SELECT count(*) FROM pg_constraint WHERE conname IN ('notifications_attempts_check', 'notifications_retry_check')) AS constraints,
      (SELECT count(*) FROM pg_indexes WHERE indexname = 'notifications_status_nextAttemptAt_idx') AS indexes`);
const targetHistory = () =>
  scratch.query<{ finished: boolean; rolled_back: boolean }>(
    `SELECT finished_at IS NOT NULL AS finished, rolled_back_at IS NOT NULL AS rolled_back FROM _prisma_migrations WHERE migration_name = '${TARGET}' ORDER BY started_at`,
  );

describe(`migration ${TARGET} : atomique sous PostgreSQL (serveur jetable)`, () => {
  let full: string;

  beforeAll(async () => {
    scratch = new Client({ connectionString: assertDisposableUrl(target.url) });
    await scratch.connect();
    // Le serveur contacté est bien le jetable : base et utilisateur de cette exécution, aucune autre base, aucun historique.
    const identity = await one<{ database: string; user: string; others: string; history: boolean }>(`
      SELECT current_database() AS database, current_user AS user,
        (SELECT count(*) FROM pg_database WHERE NOT datistemplate AND datname NOT IN ('postgres', current_database())) AS others,
        to_regclass('public._prisma_migrations') IS NOT NULL AS history`);
    expect(identity).toEqual({ database: target.database, user: target.user, others: "0", history: false });

    workDir = mkdtempSync(path.join(os.tmpdir(), `systelec-migration-${target.runId}-`));
    const before = prepareConfig("avant", false);
    full = prepareConfig("complete", true);
    const deployed = prisma(before, "migrate", "deploy");
    expect(deployed.ok).toBe(true);
    // Prisma annonce la base qu'il migre : elle doit être celle du serveur jetable.
    expect(deployed.output).toContain(`PostgreSQL database "${target.database}"`);
    await scratch.query(`INSERT INTO notifications (id, channel, template, recipient, payload, status) VALUES
      ('ancien-echec', 'EMAIL', 'order.placed', 'a@example.sn', '{}', 'FAILED'),
      ('ancien-envoi', 'EMAIL', 'order.placed', 'a@example.sn', '{}', 'SENT')`);
  }, 180_000);

  afterAll(async () => {
    try {
      await scratch?.end();
    } finally {
      // Dossier de travail de CETTE exécution uniquement ; le serveur est supprimé par le globalSetup.
      if (workDir) rmSync(workDir, { recursive: true, force: true });
    }
  });

  it("échec sur la dernière instruction : tout est annulé, reprise par resolve --rolled-back puis deploy", async () => {
    // Cause d'échec provoquée : l'index que la migration crée en dernier existe déjà.
    await scratch.query(`CREATE INDEX "notifications_status_nextAttemptAt_idx" ON notifications (status)`);

    const failed = prisma(full, "migrate", "deploy");
    expect(failed.ok).toBe(false);
    // Prisma 7.10 rapporte l'interruption de la transaction ; la cause exacte (42P07) est dans le journal
    // du serveur PostgreSQL (docker compose logs db), voir docs/04-mise-en-service.md, section 9.
    expect(failed.output).toMatch(/P3018|current transaction is aborted/);
    // Les instructions précédentes (colonnes, contraintes, mises à jour) sont annulées.
    expect(await schemaState()).toEqual({ columns: "0", constraints: "0", indexes: "1" });
    expect((await targetHistory()).rows).toEqual([{ finished: false, rolled_back: false }]);

    // Sans résolution, Prisma refuse de relancer.
    const blocked = prisma(full, "migrate", "deploy");
    expect(blocked.ok).toBe(false);
    expect(blocked.output).toContain("P3009");

    // Reprise : supprimer la cause (l'index provoqué par ce test), marquer l'échec annulé, relancer.
    await scratch.query(`DROP INDEX "notifications_status_nextAttemptAt_idx"`);
    expect(prisma(full, "migrate", "resolve", "--rolled-back", TARGET).ok).toBe(true);
    expect(prisma(full, "migrate", "deploy").ok).toBe(true);

    expect(await schemaState()).toEqual({ columns: "2", constraints: "2", indexes: "1" });
    expect((await targetHistory()).rows).toEqual([
      { finished: false, rolled_back: true },
      { finished: true, rolled_back: false },
    ]);
    const rows = await scratch.query(`SELECT id, attempts, "nextAttemptAt" FROM notifications ORDER BY id`);
    expect(rows.rows).toEqual([
      { id: "ancien-echec", attempts: 1, nextAttemptAt: null },
      { id: "ancien-envoi", attempts: 1, nextAttemptAt: null },
    ]);
    expect(prisma(full, "migrate", "status").output).toContain("Database schema is up to date");
  }, 180_000);
});
