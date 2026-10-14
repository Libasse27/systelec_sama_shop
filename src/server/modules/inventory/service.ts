import "server-only";
import { z } from "zod";
import type { Prisma, PrismaClient } from "@/generated/prisma/client";
import { recordAudit } from "@/server/audit/audit";
import { assertPermission, type Actor } from "@/server/authz/service";
import type { Db } from "@/server/db/client";
import { AppError } from "@/server/errors";
import { parseInput } from "@/server/validation";

const MAX_QUANTITY = 1_000_000;
const ALERTS_LIMIT = 500;

const variantId = z.string().min(1).max(64);
const reason = z.string().trim().min(3, "Indiquez le motif (3 caractères minimum)").max(300);
const quantity = z.number().int().positive("La quantité doit être un entier positif").max(MAX_QUANTITY);

export const stockMovementSchema = z.discriminatedUnion("type", [
  z.object({ type: z.literal("IN"), variantId, quantity, reason }),
  z.object({ type: z.literal("OUT"), variantId, quantity, reason }),
  z.object({ type: z.literal("ADJUSTMENT"), variantId, countedQuantity: z.number().int().min(0).max(MAX_QUANTITY), reason }),
]);

export type StockMovementInput = z.input<typeof stockMovementSchema>;

const parse = <T extends z.ZodType>(schema: T, input: unknown): z.infer<T> => parseInput(schema, input, "Mouvement de stock");

type Tx = Prisma.TransactionClient;
type ParsedMovement = z.infer<typeof stockMovementSchema>;

/**
 * Applique un mouvement validé dans la transaction fournie. La ligne de stock est
 * verrouillée (SELECT … FOR UPDATE) : des mouvements simultanés ne peuvent pas survendre,
 * et le stock physique ne descend jamais sous le stock réservé.
 */
export async function applyStockMovement(
  tx: Tx,
  actorId: string,
  movement: ParsedMovement,
): Promise<{ onHand: number; reserved: number; delta: number }> {
  const variant = await tx.productVariant.findUnique({ where: { id: movement.variantId }, select: { id: true, sku: true } });
  if (!variant) throw new AppError("NOT_FOUND", "Variante introuvable.");
  await tx.inventory.upsert({ where: { variantId: variant.id }, create: { variantId: variant.id }, update: {} });
  const [current] = await tx.$queryRaw<{ onHand: number; reserved: number }[]>`
    SELECT "onHand", reserved FROM inventories WHERE "variantId" = ${variant.id} FOR UPDATE`;
  const { onHand, reserved } = current!;

  const delta =
    movement.type === "IN" ? movement.quantity : movement.type === "OUT" ? -movement.quantity : movement.countedQuantity - onHand;
  const next = onHand + delta;
  if (next < reserved) {
    throw new AppError(
      "CONFLICT",
      `${variant.sku} : stock insuffisant, ${onHand - reserved} unité(s) disponible(s) hors réservations (${reserved} réservée(s)).`,
    );
  }

  const counted = movement.type === "ADJUSTMENT" ? { lastCountedAt: new Date(), lastCountedQty: movement.countedQuantity } : {};
  await tx.inventory.update({ where: { variantId: variant.id }, data: { onHand: next, ...counted } });

  if (delta !== 0) {
    await tx.stockMovement.create({
      data: {
        variantId: variant.id,
        type: movement.type,
        quantity: delta,
        onHandAfter: next,
        reservedAfter: reserved,
        reason: movement.reason,
        actorId,
      },
    });
  }
  await recordAudit(tx, {
    actorId,
    action: delta !== 0 ? "stock.movement" : "stock.count",
    entityType: "ProductVariant",
    entityId: variant.id,
    before: { onHand },
    after: { onHand: next, type: movement.type, reason: movement.reason, sku: variant.sku },
  });
  return { onHand: next, reserved, delta };
}

/** Entrée, sortie ou correction d'inventaire, motivée et tracée. */
export async function recordStockMovement(
  client: PrismaClient,
  actor: Actor,
  input: unknown,
): Promise<{ onHand: number; reserved: number }> {
  await assertPermission(client, actor, "inventory.adjust");
  const movement = parse(stockMovementSchema, input);
  return client.$transaction(async (tx) => {
    const { onHand, reserved } = await applyStockMovement(tx, actor.id, movement);
    return { onHand, reserved };
  });
}

const thresholdSchema = z.object({ variantId, alertThreshold: z.number().int().min(0).max(MAX_QUANTITY) });

/** Seuil d'alerte d'une variante (stock disponible à partir duquel elle est signalée). */
export async function setAlertThreshold(client: PrismaClient, actor: Actor, input: unknown): Promise<void> {
  await assertPermission(client, actor, "inventory.adjust");
  const { variantId: id, alertThreshold } = parse(thresholdSchema, input);
  await client.$transaction(async (tx) => {
    if (!(await tx.productVariant.findUnique({ where: { id }, select: { id: true } }))) {
      throw new AppError("NOT_FOUND", "Variante introuvable.");
    }
    const before = await tx.inventory.findUnique({ where: { variantId: id }, select: { alertThreshold: true } });
    await tx.inventory.upsert({ where: { variantId: id }, create: { variantId: id, alertThreshold }, update: { alertThreshold } });
    await recordAudit(tx, {
      actorId: actor.id,
      action: "stock.threshold",
      entityType: "ProductVariant",
      entityId: id,
      before,
      after: { alertThreshold },
    });
  });
}

export interface StockAlert {
  variantId: string;
  productId: string;
  productName: string;
  sku: string;
  variantName: string;
  onHand: number;
  reserved: number;
  available: number;
  alertThreshold: number;
}

/** Variantes actives (produits non archivés) dont le disponible a atteint le seuil d'alerte. */
export async function listStockAlerts(client: Db, actor: Actor): Promise<StockAlert[]> {
  await assertPermission(client, actor, "inventory.read");
  return client.$queryRaw<StockAlert[]>`
    SELECT i."variantId", p.id AS "productId", p.name AS "productName", v.sku, v.name AS "variantName",
           i."onHand", i.reserved, (i."onHand" - i.reserved)::int AS available, i."alertThreshold"
    FROM inventories i
    JOIN product_variants v ON v.id = i."variantId"
    JOIN products p ON p.id = v."productId"
    WHERE v."isActive" AND p.status <> 'ARCHIVED' AND (i."onHand" - i.reserved) <= i."alertThreshold"
    ORDER BY available ASC, p.name ASC
    LIMIT ${ALERTS_LIMIT}`;
}

export interface StockMovementView {
  id: string;
  type: string;
  quantity: number;
  onHandAfter: number;
  reason: string;
  createdAt: Date;
  sku: string;
  productName: string;
  actorName: string | null;
}

export const MOVEMENTS_PAGE_SIZE = 50;

/** Journal des mouvements (le plus récent d'abord), éventuellement filtré sur une variante. */
export async function listStockMovements(
  client: Db,
  actor: Actor,
  options: { variantId?: string; page?: number } = {},
): Promise<StockMovementView[]> {
  await assertPermission(client, actor, "inventory.read");
  const page = Math.max(1, Math.min(options.page ?? 1, 1000));
  const rows = await client.stockMovement.findMany({
    where: options.variantId ? { variantId: options.variantId } : undefined,
    orderBy: [{ createdAt: "desc" }, { id: "desc" }],
    skip: (page - 1) * MOVEMENTS_PAGE_SIZE,
    take: MOVEMENTS_PAGE_SIZE,
    select: {
      id: true,
      type: true,
      quantity: true,
      onHandAfter: true,
      reason: true,
      createdAt: true,
      actorId: true,
      variant: { select: { sku: true, product: { select: { name: true } } } },
    },
  });
  const actorIds = [...new Set(rows.map((row) => row.actorId).filter((id): id is string => id !== null))];
  const actors = new Map(
    (await client.user.findMany({ where: { id: { in: actorIds } }, select: { id: true, name: true } })).map((u) => [u.id, u.name]),
  );
  return rows.map((row) => ({
    id: row.id,
    type: row.type,
    quantity: row.quantity,
    onHandAfter: row.onHandAfter,
    reason: row.reason,
    createdAt: row.createdAt,
    sku: row.variant.sku,
    productName: row.variant.product.name,
    actorName: row.actorId ? (actors.get(row.actorId) ?? null) : null,
  }));
}
