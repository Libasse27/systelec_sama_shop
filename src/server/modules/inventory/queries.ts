import "server-only";
import { Prisma } from "@/generated/prisma/client";
import { assertPermission, type Actor } from "@/server/authz/service";
import type { Db } from "@/server/db/client";

export const INVENTORY_PAGE_SIZE = 50;
const MAX_SEARCH_LENGTH = 100;

export interface InventoryRow {
  variantId: string;
  productId: string;
  productName: string;
  variantName: string;
  sku: string;
  onHand: number;
  reserved: number;
  available: number;
  alertThreshold: number;
  lastCountedAt: Date | null;
}

export interface InventoryPage {
  rows: InventoryRow[];
  total: number;
  page: number;
  pageCount: number;
}

/**
 * État du stock de toutes les versions actives (produits non archivés), triées par produit.
 * Recherche sur le nom du produit, de la version ou la référence (SKU).
 */
export async function listInventory(
  client: Db,
  actor: Actor,
  options: { q?: string; page?: number; alertsOnly?: boolean } = {},
): Promise<InventoryPage> {
  await assertPermission(client, actor, "inventory.read");
  const q = options.q?.trim().slice(0, MAX_SEARCH_LENGTH);
  const pattern = q ? `%${q.replace(/[\\%_]/g, (c) => `\\${c}`)}%` : null;
  const where = Prisma.sql`
    WHERE v."isActive" AND p.status <> 'ARCHIVED'
    ${pattern ? Prisma.sql`AND (p.name ILIKE ${pattern} OR v.name ILIKE ${pattern} OR v.sku ILIKE ${pattern})` : Prisma.empty}
    ${options.alertsOnly ? Prisma.sql`AND (COALESCE(i."onHand", 0) - COALESCE(i.reserved, 0)) <= COALESCE(i."alertThreshold", 0)` : Prisma.empty}`;
  const from = Prisma.sql`
    FROM product_variants v
    JOIN products p ON p.id = v."productId"
    LEFT JOIN inventories i ON i."variantId" = v.id`;

  const [counted] = await client.$queryRaw<{ count: number }[]>`SELECT COUNT(*)::int AS count ${from} ${where}`;
  const count = counted?.count ?? 0;
  const pageCount = Math.max(1, Math.ceil(count / INVENTORY_PAGE_SIZE));
  const page = Math.min(Math.max(1, Math.trunc(options.page ?? 1)), pageCount);
  const rows = await client.$queryRaw<InventoryRow[]>`
    SELECT v.id AS "variantId", p.id AS "productId", p.name AS "productName", v.name AS "variantName", v.sku,
           COALESCE(i."onHand", 0)::int AS "onHand", COALESCE(i.reserved, 0)::int AS reserved,
           (COALESCE(i."onHand", 0) - COALESCE(i.reserved, 0))::int AS available,
           COALESCE(i."alertThreshold", 0)::int AS "alertThreshold", i."lastCountedAt"
    ${from} ${where}
    ORDER BY p.name ASC, v.position ASC, v.id
    LIMIT ${INVENTORY_PAGE_SIZE} OFFSET ${(page - 1) * INVENTORY_PAGE_SIZE}`;
  return { rows, total: count, page, pageCount };
}

export interface VariantStock {
  variantId: string;
  productId: string;
  productName: string;
  variantName: string;
  sku: string;
  isActive: boolean;
  onHand: number;
  reserved: number;
  alertThreshold: number;
  lastCountedAt: Date | null;
  lastCountedQty: number | null;
}

/** Stock détaillé d'une version (page de gestion du stock). */
export async function getVariantStock(client: Db, actor: Actor, variantId: string): Promise<VariantStock | null> {
  await assertPermission(client, actor, "inventory.read");
  const variant = await client.productVariant.findUnique({
    where: { id: variantId },
    select: { id: true, name: true, sku: true, isActive: true, product: { select: { id: true, name: true } }, inventory: true },
  });
  if (!variant) return null;
  return {
    variantId: variant.id,
    productId: variant.product.id,
    productName: variant.product.name,
    variantName: variant.name,
    sku: variant.sku,
    isActive: variant.isActive,
    onHand: variant.inventory?.onHand ?? 0,
    reserved: variant.inventory?.reserved ?? 0,
    alertThreshold: variant.inventory?.alertThreshold ?? 0,
    lastCountedAt: variant.inventory?.lastCountedAt ?? null,
    lastCountedQty: variant.inventory?.lastCountedQty ?? null,
  };
}
