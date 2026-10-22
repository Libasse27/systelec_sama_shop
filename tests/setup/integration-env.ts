import { randomBytes } from "node:crypto";
import { inject } from "vitest";
import { assertDisposableTestDatabase } from "./test-database";

// L'URL vient du conteneur PostgreSQL créé par ephemeral-integration-postgres.ts, jamais de .env.test.
const database = inject("integrationDatabase");
process.env.APP_ENV = "test";
process.env.APP_URL = "http://localhost:3000";
process.env.AUTH_SECRET = randomBytes(32).toString("base64");
process.env.DATABASE_URL = assertDisposableTestDatabase(database);
process.env.STORAGE_DRIVER = "local";
process.env.STORAGE_LOCAL_DIR = `${database.storageDirectory}/storage`;
process.env.SMTP_HOST = "";
process.env.SMTP_PORT = "";
process.env.SMTP_USER = "";
process.env.SMTP_PASSWORD = "";
process.env.SMTP_FROM = "";
