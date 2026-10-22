import { defineConfig, devices } from "@playwright/test";
import { E2E_DIST_DIR, resolveE2eRun } from "./e2e/support/database-guard";

/**
 * Ressources de CETTE exécution (base jetable, dossier de fichiers, port libre), créées et vérifiées par
 * e2e/run.ts : lancer « pnpm test:e2e ». Sans elles, la configuration refuse de démarrer.
 */
const RUN = resolveE2eRun();
const BASE_URL = `http://localhost:${RUN.port}`;

/** Tests qui modifient des paramètres globaux du site : une seule fois par exécution (projet desktop). */
const GLOBAL_SETTINGS_TAG = /@parametres-globaux/;

/**
 * Tests de bout en bout. Le serveur de production est construit puis démarré
 * sur un port dédié ; mobile d'abord, donc un profil téléphone en plus du bureau.
 */
export default defineConfig({
  testDir: "./e2e",
  globalSetup: "./e2e/global-setup.ts",
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 1 : 0,
  reporter: process.env.CI ? "github" : "list",
  // Serveur de production partagé par tous les tests en parallèle : navigations parfois > 5 s.
  expect: { timeout: 10_000 },
  use: {
    baseURL: BASE_URL,
    trace: "retain-on-failure",
    locale: "fr-SN",
    timezoneId: "Africa/Dakar",
  },
  projects: [
    { name: "desktop", use: { ...devices["Desktop Chrome"] } },
    { name: "mobile", use: { ...devices["Pixel 7"] }, grepInvert: GLOBAL_SETTINGS_TAG },
  ],
  webServer: {
    // Base préparée par e2e/run.ts (vérifiée, migrée, données de démonstration) AVANT la construction, qui la lit.
    // Build dans .next-e2e : le build de développement ou de production locale (.next) n'est pas écrasé.
    command: `pnpm build && pnpm start --port ${RUN.port}`,
    url: `${BASE_URL}/api/health`,
    // Jamais de réutilisation : un serveur déjà lancé pourrait viser la base de développement.
    reuseExistingServer: false,
    // Serveur exposé directement (aucun reverse proxy) : X-Forwarded-For n'est pas fiable.
    // Même base et même dossier de fichiers que la préparation (les variables du processus
    // l'emportent sur .env pour Next.js, Prisma et les scripts).
    env: { TRUSTED_PROXY_HOPS: "0", DATABASE_URL: RUN.databaseUrl, STORAGE_LOCAL_DIR: RUN.storageDir, NEXT_DIST_DIR: E2E_DIST_DIR },
    // Construction puis démarrage.
    timeout: 300_000,
  },
});
