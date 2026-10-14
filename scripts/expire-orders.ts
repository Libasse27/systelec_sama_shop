/**
 * Annule les commandes non confirmées dont la réservation de stock a expiré (décision D3)
 * et remet leurs articles en vente ; supprime les paniers expirés et passe « expirés » les devis
 * dont la validité est dépassée. À planifier (cron) toutes les 15 minutes environ.
 * Usage : pnpm orders:expire
 */
import { db } from "@/server/db/client";
import { purgeExpiredCarts } from "@/server/modules/cart/service";
import { expireStaleOrders } from "@/server/modules/orders/status";
import { expireQuotes } from "@/server/modules/quotes/quotes";

async function main(): Promise<void> {
  const expired = await expireStaleOrders(db);
  const purged = await purgeExpiredCarts(db);
  const quotes = await expireQuotes(db);
  console.info(`Devis expirés : ${quotes}.`);
  console.info(`Paniers expirés supprimés : ${purged}.`);
  console.info(expired.length === 0 ? "Aucune réservation expirée." : `Commandes annulées (réservation expirée) : ${expired.join(", ")}`);
}

main()
  .catch((error: unknown) => {
    console.error(error instanceof Error ? error.message : error);
    process.exitCode = 1;
  })
  .finally(() => db.$disconnect());
