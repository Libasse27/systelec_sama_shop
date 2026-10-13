/**
 * Données de DÉMONSTRATION (décision D5) : produits « [DÉMO] » à marques fictives et FAQ.
 * Refuse de s'exécuter en production. Prérequis : pnpm db:seed. Usage : pnpm db:seed:demo
 */
import { getServerEnv } from "@/lib/env";
import { db } from "@/server/db/client";
import { seedDemoCatalog } from "@/server/modules/catalog/demo";

async function main(): Promise<void> {
  if (getServerEnv().APP_ENV === "production") {
    throw new Error("Refus : les données de démonstration ne sont jamais chargées en production.");
  }
  const { productsCreated } = await seedDemoCatalog(db);
  console.info(`Démonstration : ${productsCreated} produit(s) créé(s).`);
}

main()
  .catch((error: unknown) => {
    console.error(error instanceof Error ? error.message : error);
    process.exitCode = 1;
  })
  .finally(() => db.$disconnect());
