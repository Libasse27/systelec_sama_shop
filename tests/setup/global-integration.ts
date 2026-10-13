import { execFileSync } from "node:child_process";
import { config } from "dotenv";

/**
 * Applique les migrations en attente sur la base de test avant la suite d'intégration.
 * Opération non destructive : les tables sont vidées entre les tests par `resetDatabase`
 * (tests/setup/db.ts). Pour repartir d'une base vierge : `pnpm db:test:prepare`.
 */
export default function setup(): void {
  const testEnv = config({ path: ".env.test", override: false, quiet: true }).parsed ?? {};
  const databaseUrl = testEnv.DATABASE_URL ?? process.env.DATABASE_URL ?? "";
  if (!databaseUrl.includes("systelec_test")) {
    throw new Error("Refus de migrer une base qui n'est pas systelec_test.");
  }
  execFileSync("pnpm", ["exec", "prisma", "migrate", "deploy"], {
    stdio: "inherit",
    env: { ...process.env, ...testEnv, DATABASE_URL: databaseUrl },
  });
}
