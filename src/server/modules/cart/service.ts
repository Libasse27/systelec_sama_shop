import "server-only";
import { createHash } from "node:crypto";
import { z } from "zod";
import type { Prisma, PrismaClient } from "@/generated/prisma/client";
import type { Db } from "@/server/db/client";
import { AppError } from "@/server/errors";
import { loadCategoryIndex } from "@/server/modules/catalog/queries";
import { parseInput } from "@/server/validation";

export const CART_TTL_DAYS = 30;
export const MAX_CART_LINES = 50;
export const MAX_LINE_QUANTITY = 99;

/** Propriétaire du panier : un compte, ou un visiteur identifié par l'empreinte de son jeton de cookie. */
export type CartOwner = { userId: string } | { tokenHash: string };

export function hashCartToken(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}

const ownerWhere = (owner: CartOwner): Prisma.CartWhereUniqueInput =>
  "userId" in owner ? { userId: owner.userId } : { tokenHash: owner.tokenHash };

const expiry = () => new Date(Date.now() + CART_TTL_DAYS * 24 * 3600 * 1000);

const addSchema = z.object({
  sku: z.string().trim().toUpperCase().min(1).max(64),
  quantity: z.number().int().min(1).max(MAX_LINE_QUANTITY),
});
const quantitySchema = z.object({ variantId: z.string().min(1).max(64), quantity: z.number().int().min(0).max(MAX_LINE_QUANTITY) });

/** Version vendable : produit publié, version active, catégorie visible. Renvoie aussi le disponible. */
async function findSellableVariant(client: Db, where: Prisma.ProductVariantWhereInput) {
  const variant = await client.productVariant.findFirst({
    where: { ...where, isActive: true, product: { status: "PUBLISHED" } },
    select: { id: true, product: { select: { categoryId: true } }, inventory: { select: { onHand: true, reserved: true } } },
  });
  if (!variant) return null;
  const index = await loadCategoryIndex(client);
  if (!index.byId.has(variant.product.categoryId)) return null;
  return { id: variant.id, available: Math.max(0, (variant.inventory?.onHand ?? 0) - (variant.inventory?.reserved ?? 0)) };
}

function stockMessage(available: number): string {
  return available === 0 ? "Ce produit est épuisé." : `Stock disponible : ${available} unité(s).`;
}

/** Ajoute une quantité d'une version au panier (créé au besoin), dans la limite du stock disponible. */
export async function addToCart(client: Db, owner: CartOwner, input: unknown): Promise<{ quantity: number }> {
  const { sku, quantity } = parseInput(addSchema, input, "Ajout au panier");
  const variant = await findSellableVariant(client, { sku });
  if (!variant) throw new AppError("NOT_FOUND", "Ce produit n'est pas disponible à la vente.");

  const cart = await client.cart.upsert({
    where: ownerWhere(owner),
    create: { ...owner, expiresAt: expiry() },
    update: { expiresAt: expiry() },
    select: { id: true, _count: { select: { items: true } }, items: { where: { variantId: variant.id }, select: { quantity: true } } },
  });
  const current = cart.items[0]?.quantity ?? 0;
  if (current === 0 && cart._count.items >= MAX_CART_LINES) {
    throw new AppError("CONFLICT", `Le panier est limité à ${MAX_CART_LINES} articles différents.`);
  }
  const next = Math.min(current + quantity, MAX_LINE_QUANTITY);
  if (next > variant.available) throw new AppError("CONFLICT", stockMessage(variant.available));
  await client.cartItem.upsert({
    where: { cartId_variantId: { cartId: cart.id, variantId: variant.id } },
    create: { cartId: cart.id, variantId: variant.id, quantity: next },
    update: { quantity: next },
  });
  return { quantity: next };
}

/** Modifie la quantité d'une ligne (0 la retire). Une baisse est toujours permise, une hausse dans la limite du stock. */
export async function setCartQuantity(client: Db, owner: CartOwner, input: unknown): Promise<void> {
  const { variantId, quantity } = parseInput(quantitySchema, input, "Quantité");
  const cart = await client.cart.findUnique({ where: ownerWhere(owner), select: { id: true } });
  if (!cart) return;
  const where = { cartId_variantId: { cartId: cart.id, variantId } };
  const item = await client.cartItem.findUnique({ where, select: { quantity: true } });
  if (!item) return;
  if (quantity === 0) {
    await client.cartItem.delete({ where });
    return;
  }
  if (quantity > item.quantity) {
    const variant = await findSellableVariant(client, { id: variantId });
    if (!variant) throw new AppError("CONFLICT", "Ce produit n'est plus disponible à la vente.");
    if (quantity > variant.available) throw new AppError("CONFLICT", stockMessage(variant.available));
  }
  await client.cartItem.update({ where, data: { quantity } });
}

export type CartLineIssue = "UNAVAILABLE" | "INSUFFICIENT_STOCK";

export interface CartLine {
  variantId: string;
  sku: string;
  productName: string;
  productSlug: string;
  variantName: string;
  image: { url: string; alt: string } | null;
  unitPrice: number;
  compareAtPrice: number | null;
  quantity: number;
  available: number;
  lineTotal: number;
  issue: CartLineIssue | null;
}

export interface CartView {
  lines: CartLine[];
  /** Sous-total des lignes commandables (prix actuels). */
  subtotal: number;
  itemCount: number;
  /** Vrai si toutes les lignes sont commandables et le panier non vide. */
  canCheckout: boolean;
}

const EMPTY_CART: CartView = { lines: [], subtotal: 0, itemCount: 0, canCheckout: false };

/**
 * Panier avec prix et stock relus en base. Les lignes devenues invendables ou en stock
 * insuffisant sont signalées (et bloquent la commande) au lieu d'être retirées en silence.
 */
export async function getCartView(client: Db, owner: CartOwner): Promise<CartView> {
  const cart = await client.cart.findUnique({
    where: ownerWhere(owner),
    select: {
      expiresAt: true,
      items: {
        orderBy: { createdAt: "asc" },
        select: {
          quantity: true,
          variant: {
            select: {
              id: true,
              sku: true,
              name: true,
              price: true,
              compareAtPrice: true,
              isActive: true,
              inventory: { select: { onHand: true, reserved: true } },
              product: {
                select: {
                  name: true,
                  slug: true,
                  status: true,
                  categoryId: true,
                  images: { orderBy: { position: "asc" }, take: 1, select: { url: true, alt: true } },
                },
              },
            },
          },
        },
      },
    },
  });
  if (!cart || cart.expiresAt < new Date() || cart.items.length === 0) return EMPTY_CART;
  const index = await loadCategoryIndex(client);

  const lines = cart.items.map(({ quantity, variant }): CartLine => {
    const sellable = variant.isActive && variant.product.status === "PUBLISHED" && index.byId.has(variant.product.categoryId);
    const available = Math.max(0, (variant.inventory?.onHand ?? 0) - (variant.inventory?.reserved ?? 0));
    const issue: CartLineIssue | null = !sellable ? "UNAVAILABLE" : quantity > available ? "INSUFFICIENT_STOCK" : null;
    return {
      variantId: variant.id,
      sku: variant.sku,
      productName: variant.product.name,
      productSlug: variant.product.slug,
      variantName: variant.name,
      image: variant.product.images[0] ?? null,
      unitPrice: variant.price,
      compareAtPrice: variant.compareAtPrice,
      quantity,
      available,
      lineTotal: variant.price * quantity,
      issue,
    };
  });
  const orderable = lines.filter((line) => line.issue === null);
  return {
    lines,
    subtotal: orderable.reduce((sum, line) => sum + line.lineTotal, 0),
    itemCount: lines.reduce((sum, line) => sum + line.quantity, 0),
    canCheckout: lines.length > 0 && orderable.length === lines.length,
  };
}

/** Nombre d'articles (en-tête du site), sans relire prix ni stock. */
export async function countCartItems(client: Db, owner: CartOwner): Promise<number> {
  const result = await client.cartItem.aggregate({
    where: { cart: { ...("userId" in owner ? { userId: owner.userId } : { tokenHash: owner.tokenHash }), expiresAt: { gt: new Date() } } },
    _sum: { quantity: true },
  });
  return result._sum.quantity ?? 0;
}

/**
 * À la connexion : les articles du panier visiteur rejoignent le panier du compte
 * (quantités additionnées, plafonnées), puis le panier visiteur est supprimé.
 */
export async function mergeGuestCart(client: PrismaClient, tokenHash: string, userId: string): Promise<void> {
  await client.$transaction(async (tx) => {
    const guest = await tx.cart.findUnique({ where: { tokenHash }, select: { id: true, expiresAt: true, items: true } });
    if (!guest) return;
    if (guest.expiresAt > new Date() && guest.items.length > 0) {
      const cart = await tx.cart.upsert({
        where: { userId },
        create: { userId, expiresAt: expiry() },
        update: { expiresAt: expiry() },
        select: { id: true, items: { select: { variantId: true, quantity: true } } },
      });
      const existing = new Map(cart.items.map((item) => [item.variantId, item.quantity]));
      let lines = existing.size;
      for (const item of guest.items) {
        const isNew = !existing.has(item.variantId);
        // Plafond commun aux deux paniers : les articles en surnombre ne sont pas repris.
        if (isNew && lines >= MAX_CART_LINES) continue;
        if (isNew) lines += 1;
        const quantity = Math.min((existing.get(item.variantId) ?? 0) + item.quantity, MAX_LINE_QUANTITY);
        await tx.cartItem.upsert({
          where: { cartId_variantId: { cartId: cart.id, variantId: item.variantId } },
          create: { cartId: cart.id, variantId: item.variantId, quantity },
          update: { quantity },
        });
      }
    }
    await tx.cart.delete({ where: { id: guest.id } });
  });
}

/** Supprime les paniers expirés (tâche planifiée avec l'expiration des réservations). */
export async function purgeExpiredCarts(client: Db, now: Date = new Date()): Promise<number> {
  return (await client.cart.deleteMany({ where: { expiresAt: { lt: now } } })).count;
}
