import "server-only";
import type { Prisma } from "@/generated/prisma/client";
import { AppError } from "@/server/errors";

/**
 * Verrouille la ligne d'une commande (FOR UPDATE) jusqu'à la fin de la transaction.
 * Statuts, encaissements et contre-écritures d'une même commande prennent ce verrou EN
 * PREMIER (avant tout verrou de stock) : ils s'exécutent l'un après l'autre, sans interblocage.
 */
export async function lockOrderRow(tx: Prisma.TransactionClient, orderId: string): Promise<void> {
  const [locked] = await tx.$queryRaw<{ id: string }[]>`SELECT id FROM orders WHERE id = ${orderId} FOR UPDATE`;
  if (!locked) throw new AppError("NOT_FOUND", "Commande introuvable.");
}
