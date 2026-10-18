/**
 * Données de base indispensables : rôles et permissions, structure du catalogue (§6),
 * services (§7, sur devis) et pages d'information en brouillon. Idempotent ; ne charge
 * aucune donnée de démonstration (voir seed-demo.ts). Usage : pnpm db:seed
 */
import { syncRolesAndPermissions } from "@/server/authz/sync";
import { db } from "@/server/db/client";
import { seedBaseCatalog } from "@/server/modules/catalog/seed";

async function main(): Promise<void> {
  const rbac = await syncRolesAndPermissions(db);
  console.info(
    `Rôles et permissions : ${rbac.permissionsCreated} permission(s) créée(s), ` +
      `${rbac.rolesCreated} rôle(s) créé(s), ${rbac.rolesUpdated.length} rôle(s) mis à jour.`,
  );
  const catalog = await seedBaseCatalog(db);
  console.info(
    `Catalogue : ${catalog.categoriesCreated} catégorie(s), ${catalog.servicesCreated} service(s), ` +
      `${catalog.pagesCreated} page(s) créée(s).`,
  );
}

main()
  .catch((error: unknown) => {
    console.error(error instanceof Error ? error.message : error);
    process.exitCode = 1;
  })
  .finally(() => db.$disconnect());
