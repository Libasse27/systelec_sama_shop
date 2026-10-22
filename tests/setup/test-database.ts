export interface DisposableTestDatabase {
  url: string;
  database: string;
  user: string;
  port: number;
  runId: string;
  containerId: string;
  containerLabel: string;
}

/** L'URL doit correspondre à toutes les valeurs injectées par le lanceur de ce run. */
export function assertDisposableTestDatabase(database: DisposableTestDatabase): string {
  let url: URL;
  try {
    url = new URL(database.url);
  } catch {
    throw new Error("DATABASE_URL d'intégration absente ou invalide.");
  }
  const safeRun = /^[a-f0-9]{24}$/.test(database.runId);
  const safeContainer = /^[a-f0-9]{64}$/.test(database.containerId);
  const expectedLabel = database.runId;
  if (
    !safeRun || !safeContainer || database.containerLabel !== expectedLabel ||
    !["postgres:", "postgresql:"].includes(url.protocol) || url.hostname !== "127.0.0.1" ||
    url.port !== String(database.port) || !Number.isInteger(database.port) || database.port < 1 || database.port > 65535 ||
    url.pathname !== `/${database.database}` || decodeURIComponent(url.username) !== database.user || !url.password ||
    url.search !== "" || url.hash !== "" || database.database !== "systelec_test" ||
    database.user !== `it_${database.runId.slice(0, 12)}`
  ) {
    throw new Error("Refus : l'URL ne correspond pas au PostgreSQL jetable créé pour cette exécution.");
  }
  return database.url;
}
