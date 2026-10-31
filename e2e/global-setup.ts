import { resolveE2eRun } from "./support/database-guard";
import { assertRunDatabase } from "./prepare-database";

/**
 * Dernier contrôle avant les tests : la base préparée par le lanceur (e2e/run.ts) est bien la base jetable
 * de cette exécution, confirmée par le serveur PostgreSQL (base, utilisateur, marque de l'exécution).
 */
export default async function globalSetup(): Promise<void> {
  await assertRunDatabase(resolveE2eRun());
}
