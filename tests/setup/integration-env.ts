import { config } from "dotenv";

// Les tests d'intégration ciblent exclusivement la base de test.
config({ path: ".env.test", override: true, quiet: true });

if (!process.env.DATABASE_URL?.includes("systelec_test")) {
  throw new Error("Les tests d'intégration doivent utiliser la base systelec_test (voir .env.test).");
}
