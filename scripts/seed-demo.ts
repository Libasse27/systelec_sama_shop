/**
 * Données de DÉMONSTRATION (décision D5) : produits « [DÉMO] » à marques fictives et FAQ.
 * Refuse de s'exécuter en production et exige ALLOW_DEMO_SEED=1.
 * Prérequis : pnpm db:seed. Usage : ALLOW_DEMO_SEED=1 pnpm db:seed:demo
 */
import { getServerEnv } from "@/lib/env";
import { db } from "@/server/db/client";
import { seedDemoCatalog } from "@/server/modules/catalog/demo";

async function main(): Promise<void> {
  if (getServerEnv().APP_ENV === "production") {
    throw new Error("Refus : les données de démonstration ne sont jamais chargées en production.");
  }
  // Double garde : un APP_ENV oublié (défaut « development ») ne suffit pas à charger la démo.
  if (process.env.ALLOW_DEMO_SEED !== "1") {
    throw new Error("Refus : définissez ALLOW_DEMO_SEED=1 pour charger les données de démonstration.");
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
