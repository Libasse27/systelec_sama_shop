import "server-only";
import type { Prisma } from "@/generated/prisma/client";
import { AppError } from "@/server/errors";

type Tx = Prisma.TransactionClient;

export interface StockLevel {
  variantId: string;
  onHand: number;
  reserved: number;
}

/**
 * Verrouille les lignes de stock des versions données, TOUJOURS dans le même ordre (id croissant)
 * pour éviter les interblocages entre commandes simultanées. Crée les lignes manquantes à 0.
 */
export async function lockStock(tx: Tx, variantIds: readonly string[]): Promise<Map<string, StockLevel>> {
  const ids = [...new Set(variantIds)].sort();
  await tx.inventory.createMany({ data: ids.map((variantId) => ({ variantId })), skipDuplicates: true });
  const levels = new Map<string, StockLevel>();
  for (const id of ids) {
    const [row] = await tx.$queryRaw<StockLevel[]>`
      SELECT "variantId", "onHand", reserved FROM inventories WHERE "variantId" = ${id} FOR UPDATE`;
    if (row) levels.set(id, row);
  }
  return levels;
}

interface OrderStockChange {
  variantId: string;
  quantity: number;
  orderId: string;
  reason: string;
  actorId: string | null;
}

async function applyChange(
  tx: Tx,
  levels: Map<string, StockLevel>,
  type: "RESERVE" | "RELEASE" | "SALE",
  change: OrderStockChange,
): Promise<void> {
  const level = levels.get(change.variantId);
  if (!level) throw new AppError("INTERNAL", "Ligne de stock non verrouillée.");
  const delta = {
    RESERVE: { onHand: 0, reserved: change.quantity },
    RELEASE: { onHand: 0, reserved: -change.quantity },
    SALE: { onHand: -change.quantity, reserved: -change.quantity },
  }[type];
  const next = { variantId: level.variantId, onHand: level.onHand + delta.onHand, reserved: level.reserved + delta.reserved };
  if (next.reserved < 0 || next.onHand < next.reserved) throw new AppError("CONFLICT", "Stock insuffisant pour cette opération.");
  await tx.inventory.update({ where: { variantId: level.variantId }, data: { onHand: next.onHand, reserved: next.reserved } });
  await tx.stockMovement.create({
    data: {
      variantId: level.variantId,
      type,
      // RESERVE/RELEASE : variation du réservé ; SALE : variation du physique (journal, §5).
      quantity: type === "SALE" ? delta.onHand : delta.reserved,
      onHandAfter: next.onHand,
      reservedAfter: next.reserved,
      reason: change.reason,
      actorId: change.actorId,
      orderId: change.orderId,
    },
  });
  levels.set(level.variantId, next);
}

/** Réserve le stock d'une ligne de commande (lignes verrouillées par lockStock). */
export const reserveStock = (tx: Tx, levels: Map<string, StockLevel>, change: OrderStockChange) =>
  applyChange(tx, levels, "RESERVE", change);

/** Libère une réservation (annulation, expiration). */
export const releaseStock = (tx: Tx, levels: Map<string, StockLevel>, change: OrderStockChange) =>
  applyChange(tx, levels, "RELEASE", change);

/** Sortie définitive à la remise au client : le réservé et le physique baissent ensemble. */
export const commitSale = (tx: Tx, levels: Map<string, StockLevel>, change: OrderStockChange) =>
  applyChange(tx, levels, "SALE", change);
