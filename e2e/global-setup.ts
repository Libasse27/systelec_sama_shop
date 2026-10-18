import { resolveE2eDatabaseUrl } from "./support/database-guard";
import { assertConnectedTo } from "./prepare-database";

/**
 * Dernier contrôle avant les tests : la base préparée par la commande du serveur web
 * (e2e/prepare-database.ts) est bien la base E2E dédiée, confirmée par le serveur PostgreSQL.
 */
export default async function globalSetup(): Promise<void> {
  await assertConnectedTo(resolveE2eDatabaseUrl());
}
