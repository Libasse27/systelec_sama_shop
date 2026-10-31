import { randomBytes } from "node:crypto";
import {
  createPasswordVolume,
  publishedPort,
  removeOwnContainer,
  removePasswordVolume,
  runPostgresContainer,
  waitUntilReady,
} from "../../tests/setup/ephemeral-postgres";
import { E2E_DATABASE_NAME, e2eDatabaseUser } from "./database-guard";

/**
 * PostgreSQL jetable d'UNE exécution E2E (lanceur e2e/run.ts et tests des protections) : volume secret et
 * conteneur étiquetés avec l'identifiant de l'exécution, port local aléatoire, identifiants aléatoires.
 * Chaque ressource est déclarée à `defer` dès sa création : elle est supprimée même si la suite échoue,
 * et seulement si son étiquette est toujours celle de l'exécution.
 */

export interface RunDatabase {
  containerId: string;
  containerName: string;
  secretVolume: string;
  databaseUrl: string;
}

type Defer = (step: { label: string; run: () => void }) => void;

export const e2eContainerName = (runId: string): string => `systelec-e2e-${runId}`;
export const e2eSecretVolume = (runId: string): string => `systelec-e2esecret-${runId}`;

export async function startRunDatabase(runId: string, defer: Defer): Promise<RunDatabase> {
  const user = e2eDatabaseUser(runId);
  const password = randomBytes(24).toString("hex");
  const containerName = e2eContainerName(runId);
  const secretVolume = e2eSecretVolume(runId);

  createPasswordVolume(secretVolume, runId, password);
  defer({ label: `volume ${secretVolume}`, run: () => removePasswordVolume(secretVolume, runId) });
  const containerId = runPostgresContainer({ name: containerName, runId, user, database: E2E_DATABASE_NAME, secretVolume });
  defer({ label: `conteneur ${containerName}`, run: () => removeOwnContainer(containerId, runId) });

  const databasePort = await publishedPort(containerId, runId, containerName);
  const databaseUrl = `postgresql://${user}:${password}@127.0.0.1:${databasePort}/${E2E_DATABASE_NAME}`;
  await waitUntilReady(databaseUrl, containerId);
  return { containerId, containerName, secretVolume, databaseUrl };
}
