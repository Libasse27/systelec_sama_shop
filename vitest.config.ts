import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

const fromRoot = (path: string) => fileURLToPath(new URL(path, import.meta.url));

export default defineConfig({
  resolve: {
    alias: {
      "@": fromRoot("./src"),
      "server-only": fromRoot("./tests/stubs/server-only.ts"),
    },
  },
  test: {
    environment: "node",
    projects: [
      {
        extends: true,
        test: {
          name: "unit",
          include: ["src/**/*.test.ts", "tests/policy/**/*.test.ts"],
          exclude: ["**/*.int.test.ts", "**/*.migration.test.ts", "node_modules/**"],
        },
      },
      {
        extends: true,
        test: {
          name: "integration",
          include: ["src/**/*.int.test.ts"],
          setupFiles: ["./tests/setup/integration-env.ts"],
          globalSetup: ["./tests/setup/ephemeral-integration-postgres.ts"],
          fileParallelism: false,
          testTimeout: 30_000,
          hookTimeout: 120_000,
        },
      },
      {
        extends: true,
        test: {
          // Migrations rejouées sur un PostgreSQL JETABLE (conteneur créé pour l'exécution) : ni base de test
          // partagée, ni globalSetup d'intégration. Docker requis.
          name: "migration",
          include: ["src/**/*.migration.test.ts"],
          globalSetup: ["./tests/setup/ephemeral-postgres.ts"],
          fileParallelism: false,
          testTimeout: 180_000,
          hookTimeout: 180_000,
        },
      },
    ],
  },
});
