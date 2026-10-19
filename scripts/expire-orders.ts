/**
 * Annule les commandes non confirmées dont la réservation de stock a expiré (décision D3)
 * et remet leurs articles en vente ; supprime les paniers expirés et passe « expirés » les devis
 * dont la validité est dépassée ; alerte les administrateurs des retours sans action après
 * 24 heures ouvrables (décision 2, une seule alerte par retour, jamais d'annulation) ; relance les
 * vérifications restées sans réponse, puis escalade aux administrateurs (phase 10, décision 4) ; renvoie
 * les e-mails en échec dont l'heure de nouvel essai est passée (15 min, 1 h, puis 4 h ; 4 envois au plus).
 * À planifier (cron) toutes les 15 minutes environ.
 * Usage : pnpm orders:expire
 */
import { db } from "@/server/db/client";
import { retryNotifications } from "@/server/notifications/queue";
import { purgeExpiredCarts } from "@/server/modules/cart/service";
import { expireStaleOrders } from "@/server/modules/orders/status";
import { expireQuotes } from "@/server/modules/quotes/quotes";
import { notifyOverdueReturns } from "@/server/modules/returns/overdue";
import { remindPendingVerifications } from "@/server/modules/returns/reminders";

async function main(): Promise<void> {
  const expired = await expireStaleOrders(db);
  const purged = await purgeExpiredCarts(db);
  const quotes = await expireQuotes(db);
  const overdueReturns = await notifyOverdueReturns(db);
  console.info(overdueReturns.length === 0 ? "Aucun retour en retard de traitement." : `Retours en retard, administrateurs alertés : ${overdueReturns.join(", ")}`);
  const reminders = await remindPendingVerifications(db);
  console.info(
    reminders.length === 0
      ? "Aucune vérification à relancer."
      : `Vérifications relancées : ${reminders.map((reminder) => `${reminder.number} (${reminder.stage === 3 ? "escalade" : `relance ${reminder.stage}`})`).join(", ")}`,
  );
  console.info(`Devis expirés : ${quotes}.`);
  console.info(`Paniers expirés supprimés : ${purged}.`);
  console.info(expired.length === 0 ? "Aucune réservation expirée." : `Commandes annulées (réservation expirée) : ${expired.join(", ")}`);
  // En dernier : les alertes et relances ci-dessus ont déjà tenté leur propre envoi.
  const retried = await retryNotifications(db);
  console.info(`E-mails renvoyés : ${retried.sent} envoyé(s), ${retried.failed} en échec, ${retried.skipped} sans fournisseur.`);
}

main()
  .catch((error: unknown) => {
    console.error(error instanceof Error ? error.message : error);
    process.exitCode = 1;
  })
  .finally(() => db.$disconnect());
