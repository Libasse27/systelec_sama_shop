import "server-only";
import { Prisma, type PrismaClient, type ProductStatus } from "@/generated/prisma/client";
import { slugify } from "@/lib/slug";
import { recordAudit } from "@/server/audit/audit";
import { assertPermission, type Actor } from "@/server/authz/service";
import { AppError, ValidationError } from "@/server/errors";
import { parseInput as parse } from "@/server/validation";
import { newProductSchema, productInputSchema, variantInputSchema } from "./admin-schemas";

type Tx = Prisma.TransactionClient;

function uniqueConflict(error: unknown): never {
  if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002") {
    const target = String((error.meta as { target?: unknown } | undefined)?.target ?? "");
    throw new AppError(
      "CONFLICT",
      target.includes("sku") ? "Cette référence (SKU) existe déjà." : "Cet identifiant d'URL est déjà utilisé.",
    );
  }
  throw error;
}

/** Marque retrouvée ou créée à partir de son nom (null si non renseignée). */
async function resolveBrand(tx: Tx, brandName: string | null): Promise<string | null> {
  if (!brandName) return null;
  const slug = slugify(brandName);
  const brand = await tx.brand.upsert({ where: { slug }, create: { name: brandName, slug }, update: {}, select: { id: true } });
  return brand.id;
}

async function assertCategoryExists(tx: Tx, categoryId: string): Promise<void> {
  if (!(await tx.category.findUnique({ where: { id: categoryId }, select: { id: true } }))) {
    throw new AppError("NOT_FOUND", "Catégorie introuvable.");
  }
}

/**
 * Verrouille le produit pour la durée de la transaction : les règles portant sur l'ensemble de
 * ses versions (version par défaut active, produit publié avec une version active) sont
 * vérifiées sans course entre deux administrateurs.
 */
async function lockProduct(tx: Tx, productId: string): Promise<void> {
  const rows = await tx.$queryRaw<{ id: string }[]>`SELECT id FROM products WHERE id = ${productId} FOR UPDATE`;
  if (rows.length === 0) throw new AppError("NOT_FOUND", "Produit introuvable.");
}

/** Produit d'une version, puis verrou sur ce produit (le rattachement d'une version ne change jamais). */
async function lockProductOfVariant(tx: Tx, variantId: string): Promise<void> {
  const variant = await tx.productVariant.findUnique({ where: { id: variantId }, select: { productId: true } });
  if (!variant) throw new AppError("NOT_FOUND", "Version introuvable.");
  await lockProduct(tx, variant.productId);
}

/** Crée un produit en BROUILLON avec sa variante par défaut et une ligne de stock à 0. */
export async function createProduct(client: PrismaClient, actor: Actor, input: unknown): Promise<{ id: string }> {
  await assertPermission(client, actor, "products.create");
  const parsed = parse(newProductSchema, input, "Produit");
  const { product } = parsed;
  // Le prix d'achat n'est saisi que par qui peut le relire (products.update).
  const variant = actor.permissions.has("products.update") ? parsed.variant : { ...parsed.variant, costPrice: null };
  const { brandName, ...fields } = product;

  return client.$transaction(async (tx) => {
    await assertCategoryExists(tx, fields.categoryId);
    const created = await tx.product
      .create({
        data: {
          ...fields,
          brandId: await resolveBrand(tx, brandName),
          status: "DRAFT",
          variants: { create: { ...variant, isDefault: true, position: 0, inventory: { create: {} } } },
        },
        select: { id: true },
      })
      .catch(uniqueConflict);
    await recordAudit(tx, {
      actorId: actor.id,
      action: "product.create",
      entityType: "Product",
      entityId: created.id,
      after: { ...product, variant },
    });
    return created;
  });
}

export async function updateProduct(client: PrismaClient, actor: Actor, id: string, input: unknown): Promise<void> {
  await assertPermission(client, actor, "products.update");
  const { brandName, ...fields } = parse(productInputSchema, input, "Produit");
  await client.$transaction(async (tx) => {
    const before = await tx.product.findUnique({ where: { id } });
    if (!before) throw new AppError("NOT_FOUND", "Produit introuvable.");
    await assertCategoryExists(tx, fields.categoryId);
    await tx.product.update({ where: { id }, data: { ...fields, brandId: await resolveBrand(tx, brandName) } }).catch(uniqueConflict);
    await recordAudit(tx, { actorId: actor.id, action: "product.update", entityType: "Product", entityId: id, before, after: fields });
  });
}

const STATUS_PERMISSION = { DRAFT: "products.update", PUBLISHED: "products.update", ARCHIVED: "products.archive" } as const;

/**
 * Publication (exige une version active), retour en brouillon, archivage. Archiver comme
 * désarchiver demandent la permission dédiée. Un produit publié sans stock reste visible
 * comme « Épuisé » : c'est voulu.
 */
export async function setProductStatus(client: PrismaClient, actor: Actor, id: string, status: ProductStatus): Promise<void> {
  if (!Object.hasOwn(STATUS_PERMISSION, status)) throw new ValidationError("Statut de produit inconnu.");
  await assertPermission(client, actor, STATUS_PERMISSION[status]);
  // Hors transaction : un refus doit rester inscrit au journal d'audit.
  const current = await client.product.findUnique({ where: { id }, select: { status: true } });
  if (current?.status === "ARCHIVED" && status !== "ARCHIVED") await assertPermission(client, actor, "products.archive");
  await client.$transaction(async (tx) => {
    await lockProduct(tx, id);
    const product = await tx.product.findUnique({
      where: { id },
      select: { status: true, publishedAt: true, _count: { select: { variants: { where: { isActive: true } } } } },
    });
    if (!product) throw new AppError("NOT_FOUND", "Produit introuvable.");
    if (status === "PUBLISHED" && product._count.variants === 0) {
      throw new AppError("CONFLICT", "Impossible de publier un produit sans version active.");
    }
    await tx.product.update({
      where: { id },
      data: { status, publishedAt: status === "PUBLISHED" ? (product.publishedAt ?? new Date()) : product.publishedAt },
    });
    await recordAudit(tx, {
      actorId: actor.id,
      action: "product.status",
      entityType: "Product",
      entityId: id,
      before: { status: product.status },
      after: { status },
    });
  });
}

/** Ajoute une version (variante) au produit, avec sa ligne de stock à 0. */
export async function addVariant(client: PrismaClient, actor: Actor, productId: string, input: unknown): Promise<{ id: string }> {
  await assertPermission(client, actor, "products.update");
  const variant = parse(variantInputSchema, input, "Version");
  return client.$transaction(async (tx) => {
    await lockProduct(tx, productId);
    const position = await tx.productVariant.count({ where: { productId } });
    const created = await tx.productVariant
      .create({ data: { ...variant, productId, position, inventory: { create: {} } }, select: { id: true } })
      .catch(uniqueConflict);
    await recordAudit(tx, { actorId: actor.id, action: "variant.create", entityType: "ProductVariant", entityId: created.id, after: variant });
    return created;
  });
}

/**
 * Modifie une version. La version par défaut ne peut pas être désactivée (en choisir une autre
 * d'abord) et un produit publié garde toujours au moins une version active.
 */
export async function updateVariant(client: PrismaClient, actor: Actor, variantId: string, input: unknown): Promise<void> {
  await assertPermission(client, actor, "products.update");
  const variant = parse(variantInputSchema, input, "Version");
  await client.$transaction(async (tx) => {
    await lockProductOfVariant(tx, variantId);
    const before = await tx.productVariant.findUnique({ where: { id: variantId }, include: { product: { select: { status: true } } } });
    if (!before) throw new AppError("NOT_FOUND", "Version introuvable.");
    if (!variant.isActive && before.isDefault) {
      throw new AppError("CONFLICT", "Choisissez d'abord une autre version par défaut avant de désactiver celle-ci.");
    }
    await tx.productVariant.update({ where: { id: variantId }, data: variant }).catch(uniqueConflict);
    const { product, ...beforeVariant } = before;
    await recordAudit(tx, {
      actorId: actor.id,
      action: "variant.update",
      entityType: "ProductVariant",
      entityId: variantId,
      before: beforeVariant,
      after: variant,
    });
    const activeLeft = await tx.productVariant.count({ where: { productId: before.productId, isActive: true } });
    if (product.status === "PUBLISHED" && activeLeft === 0) {
      throw new AppError("CONFLICT", "Un produit publié doit garder au moins une version active.");
    }
  });
}

/** Désigne la version par défaut (affichée dans les listes) ; elle doit être active. */
export async function setDefaultVariant(client: PrismaClient, actor: Actor, variantId: string): Promise<void> {
  await assertPermission(client, actor, "products.update");
  await client.$transaction(async (tx) => {
    await lockProductOfVariant(tx, variantId);
    const variant = await tx.productVariant.findUnique({ where: { id: variantId }, select: { productId: true, isActive: true } });
    if (!variant) throw new AppError("NOT_FOUND", "Version introuvable.");
    if (!variant.isActive) throw new AppError("CONFLICT", "La version par défaut doit être active.");
    // Ordre imposé par l'index unique partiel : retirer l'ancienne avant de poser la nouvelle.
    await tx.productVariant.updateMany({ where: { productId: variant.productId, isDefault: true }, data: { isDefault: false } });
    await tx.productVariant.update({ where: { id: variantId }, data: { isDefault: true } });
    await recordAudit(tx, { actorId: actor.id, action: "variant.default", entityType: "ProductVariant", entityId: variantId });
  });
}
