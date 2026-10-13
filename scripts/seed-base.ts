/**
 * Données de base indispensables (rôles et permissions). Idempotent ; ne charge
 * aucune donnée de démonstration. Usage : pnpm db:seed
 */
import { syncRolesAndPermissions } from "@/server/authz/sync";
import { db } from "@/server/db/client";

async function main(): Promise<void> {
  const result = await syncRolesAndPermissions(db);
  console.info(
    `Rôles et permissions synchronisés : ${result.permissionsCreated} permission(s) créée(s), ` +
      `${result.rolesCreated} rôle(s) créé(s), ${result.rolesUpdated.length} rôle(s) mis à jour.`,
  );
}

main()
  .catch((error: unknown) => {
    console.error(error instanceof Error ? error.message : error);
    process.exitCode = 1;
  })
  .finally(() => db.$disconnect());
