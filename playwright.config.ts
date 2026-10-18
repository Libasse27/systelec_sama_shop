import { defineConfig, devices } from "@playwright/test";
import { E2E_STORAGE_DIR, resolveE2eDatabaseUrl } from "./e2e/support/database-guard";

const PORT = 3100;
const BASE_URL = `http://localhost:${PORT}`;

/** Base E2E dédiée, vérifiée avant tout (jamais la base de développement) : voir e2e/support/database-guard.ts. */
const E2E_DATABASE_URL = resolveE2eDatabaseUrl();

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
    { name: "mobile", use: { ...devices["Pixel 7"] } },
  ],
  webServer: {
    // Base E2E préparée (vérifiée, migrée, données de démonstration) AVANT la construction, qui la lit.
    command: `pnpm exec tsx e2e/prepare-database.ts && pnpm build && pnpm start --port ${PORT}`,
    url: `${BASE_URL}/api/health`,
    // Jamais de réutilisation : un serveur déjà lancé pourrait viser la base de développement.
    reuseExistingServer: false,
    // Serveur exposé directement (aucun reverse proxy) : X-Forwarded-For n'est pas fiable.
    // Même base et même dossier de fichiers que la préparation globale (les variables du processus
    // l'emportent sur .env pour Next.js, Prisma et les scripts).
    env: { TRUSTED_PROXY_HOPS: "0", DATABASE_URL: E2E_DATABASE_URL, STORAGE_LOCAL_DIR: E2E_STORAGE_DIR },
    // Préparation de la base E2E, construction puis démarrage.
    timeout: 300_000,
  },
});
