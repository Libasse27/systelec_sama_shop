/**
 * Compatibilité volontairement inutilisée : vitest.config.ts affecte le projet integration à
 * ephemeral-integration-postgres.ts. Cette garde échoue si une configuration réactive l'ancien
 * setup partagé, qui pouvait muter la base systelec_test via .env.test.
 */
export default function setup(): never {
  throw new Error("Global setup partagé désactivé : utilisez le PostgreSQL jetable de Vitest.");
}
