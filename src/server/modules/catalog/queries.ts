import "server-only";
import { z } from "zod";
import { Prisma, type ProductCondition } from "@/generated/prisma/client";
import { isValidSlug } from "@/lib/slug";
import type { Db } from "@/server/db/client";
import { PAGE_SIZE, type ListingParams, type SortOption } from "./listing-params";

// ─── Catégories ──────────────────────────────────────────────────────────────

export interface CategoryNode {
  id: string;
  parentId: string | null;
  name: string;
  slug: string;
  description: string | null;
  seoTitle: string | null;
  seoDescription: string | null;
  updatedAt: Date;
}

export interface CategoryIndex {
  bySlug: ReadonlyMap<string, CategoryNode>;
  byId: ReadonlyMap<string, CategoryNode>;
  /** Enfants visibles, triés par position (clé null = racines). */
  children: ReadonlyMap<string | null, readonly CategoryNode[]>;
}

/**
 * Charge les catégories VISIBLES : actives et dont tous les ancêtres sont actifs.
 * Le catalogue compte quelques centaines de catégories au plus : un seul chargement suffit.
 */
export async function loadCategoryIndex(client: Db): Promise<CategoryIndex> {
  const rows = await client.category.findMany({
    orderBy: [{ position: "asc" }, { name: "asc" }],
    select: {
      id: true,
      parentId: true,
      name: true,
      slug: true,
      description: true,
      seoTitle: true,
      seoDescription: true,
      isActive: true,
      updatedAt: true,
    },
  });
  const all = new Map(rows.map((row) => [row.id, row]));
  const isVisible = (id: string | null, depth = 0): boolean => {
    if (id === null) return true;
    const row = all.get(id);
    return Boolean(row?.isActive) && depth < 20 && isVisible(row!.parentId, depth + 1);
  };

  const visible: CategoryNode[] = rows
    .filter((row) => isVisible(row.id))
    .map((row) => ({
      id: row.id,
      parentId: row.parentId,
      name: row.name,
      slug: row.slug,
      description: row.description,
      seoTitle: row.seoTitle,
      seoDescription: row.seoDescription,
      updatedAt: row.updatedAt,
    }));
  const children = new Map<string | null, CategoryNode[]>();
  for (const node of visible) {
    children.set(node.parentId, [...(children.get(node.parentId) ?? []), node]);
  }
  return {
    bySlug: new Map(visible.map((node) => [node.slug, node])),
    byId: new Map(visible.map((node) => [node.id, node])),
    children,
  };
}

/** La catégorie et toutes ses sous-catégories visibles. */
export function descendantIds(index: CategoryIndex, categoryId: string): string[] {
  const ids = [categoryId];
  for (let i = 0; i < ids.length; i += 1) {
    ids.push(...(index.children.get(ids[i]!) ?? []).map((child) => child.id));
  }
  return ids;
}

/** Chemin de la racine jusqu'à la catégorie (fil d'Ariane). */
export function categoryPath(index: CategoryIndex, categoryId: string): CategoryNode[] {
  const path: CategoryNode[] = [];
  let current = index.byId.get(categoryId);
  while (current && path.length < 20) {
    path.unshift(current);
    current = current.parentId ? index.byId.get(current.parentId) : undefined;
  }
  return path;
}

// ─── Fiches résumées (listes) ────────────────────────────────────────────────

export interface ProductCard {
  slug: string;
  name: string;
  shortDescription: string;
  brand: string | null;
  category: string;
  condition: ProductCondition;
  price: number;
  compareAtPrice: number | null;
  available: number;
  image: { url: string; alt: string } | null;
}

interface ProductQuery {
  scopeIds: readonly string[];
  q?: string;
  brand?: string;
  min?: number;
  max?: number;
  inStock?: boolean;
  featuredOnly?: boolean;
  sort: SortOption;
}

const ORDER_BY: Record<SortOption, Prisma.Sql> = {
  pertinence: Prisma.sql`relevance DESC, "isFeatured" DESC, "publishedAt" DESC NULLS LAST, id`,
  "prix-croissant": Prisma.sql`price ASC, id`,
  "prix-decroissant": Prisma.sql`price DESC, id`,
  nouveautes: Prisma.sql`"publishedAt" DESC NULLS LAST, "createdAt" DESC, id`,
};

const MAX_TERMS = 5;
const escapeLike = (value: string) => value.replace(/[\\%_]/g, (char) => `\\${char}`);

/** Un mot recherché doit apparaître dans le nom, le modèle, la marque, la catégorie ou un SKU. */
function termCondition(term: string): Prisma.Sql {
  const pattern = `%${escapeLike(term)}%`;
  return Prisma.sql`(
    unaccent(p.name) ILIKE unaccent(${pattern})
    OR unaccent(COALESCE(p.model, '')) ILIKE unaccent(${pattern})
    OR unaccent(COALESCE(b.name, '')) ILIKE unaccent(${pattern})
    OR unaccent(c.name) ILIKE unaccent(${pattern})
    OR EXISTS (SELECT 1 FROM product_variants sv WHERE sv."productId" = p.id AND sv."isActive" AND sv.sku ILIKE ${pattern})
  )`;
}

function filteredProducts(query: ProductQuery): Prisma.Sql {
  const terms = (query.q ?? "").split(/\s+/).filter(Boolean).slice(0, MAX_TERMS);
  const conditions: Prisma.Sql[] = [
    Prisma.sql`p.status = 'PUBLISHED'`,
    Prisma.sql`p."categoryId" = ANY(${[...query.scopeIds]})`,
    ...terms.map(termCondition),
  ];
  if (query.brand) conditions.push(Prisma.sql`b.slug = ${query.brand}`);
  if (query.min !== undefined) conditions.push(Prisma.sql`dv.price >= ${query.min}`);
  if (query.max !== undefined) conditions.push(Prisma.sql`dv.price <= ${query.max}`);
  if (query.featuredOnly) conditions.push(Prisma.sql`p."isFeatured"`);
  const fullPattern = query.q ? `%${escapeLike(query.q)}%` : "";
  const prefix = query.q ? `${escapeLike(query.q)}%` : "";

  // Variante affichée : la variante par défaut si elle est active, sinon la première active
  // (même règle que la fiche produit). Sans variante active, le produit n'est pas listé.
  return Prisma.sql`
    SELECT p.id, p.slug, p.name, p."shortDescription", p.condition, p."isFeatured", p."publishedAt", p."createdAt",
           b.name AS brand, c.name AS category, dv.price, dv."compareAtPrice",
           COALESCE((SELECT SUM(i."onHand" - i.reserved) FROM product_variants v
                     JOIN inventories i ON i."variantId" = v.id
                     WHERE v."productId" = p.id AND v."isActive"), 0)::int AS available,
           CASE WHEN ${prefix} <> '' AND unaccent(p.name) ILIKE unaccent(${prefix}) THEN 3
                WHEN ${fullPattern} <> '' AND unaccent(p.name) ILIKE unaccent(${fullPattern}) THEN 2
                ELSE 1 END AS relevance
    FROM products p
    JOIN categories c ON c.id = p."categoryId"
    LEFT JOIN brands b ON b.id = p."brandId"
    JOIN LATERAL (
      SELECT v.price, v."compareAtPrice" FROM product_variants v
      WHERE v."productId" = p.id AND v."isActive"
      ORDER BY v."isDefault" DESC, v.position ASC, v.id ASC LIMIT 1
    ) dv ON TRUE
    WHERE ${Prisma.join(conditions, " AND ")}`;
}

/** Image principale, calculée seulement pour les lignes de la page (après LIMIT). */
const WITH_IMAGE = Prisma.sql`
  (SELECT im.url FROM product_images im WHERE im."productId" = f.id ORDER BY im.position LIMIT 1) AS "imageUrl",
  (SELECT im.alt FROM product_images im WHERE im."productId" = f.id ORDER BY im.position LIMIT 1) AS "imageAlt"`;

interface ProductCardRow {
  slug: string;
  name: string;
  shortDescription: string;
  brand: string | null;
  category: string;
  condition: ProductCondition;
  price: number;
  compareAtPrice: number | null;
  available: number;
  imageUrl: string | null;
  imageAlt: string | null;
}

const toCard = (row: ProductCardRow): ProductCard => ({
  slug: row.slug,
  name: row.name,
  shortDescription: row.shortDescription,
  brand: row.brand,
  category: row.category,
  condition: row.condition,
  price: row.price,
  compareAtPrice: row.compareAtPrice,
  available: Math.max(0, row.available),
  image: row.imageUrl ? { url: row.imageUrl, alt: row.imageAlt ?? row.name } : null,
});

export interface ProductPage {
  items: ProductCard[];
  total: number;
  page: number;
  pageCount: number;
}

/** Liste paginée de produits publiés dans un périmètre de catégories visibles. */
export async function searchProducts(client: Db, scopeIds: readonly string[], params: ListingParams): Promise<ProductPage> {
  const query: ProductQuery = {
    scopeIds,
    q: params.q,
    brand: params.marque,
    min: params.min,
    max: params.max,
    inStock: params.dispo,
    sort: params.tri,
  };
  const base = filteredProducts(query);
  const stockFilter = query.inStock ? Prisma.sql`WHERE available > 0` : Prisma.empty;
  const offset = (params.page - 1) * PAGE_SIZE;

  const [countRows, rows] = await Promise.all([
    client.$queryRaw<{ total: bigint }[]>`SELECT COUNT(*) AS total FROM (${base}) f ${stockFilter}`,
    client.$queryRaw<ProductCardRow[]>`
      SELECT f.*, ${WITH_IMAGE} FROM (
        SELECT * FROM (${base}) page ${stockFilter}
        ORDER BY ${ORDER_BY[query.sort]} LIMIT ${PAGE_SIZE} OFFSET ${offset}
      ) f ORDER BY ${ORDER_BY[query.sort]}`,
  ]);
  const total = Number(countRows[0]?.total ?? 0);
  return { items: rows.map(toCard), total, page: params.page, pageCount: Math.max(1, Math.ceil(total / PAGE_SIZE)) };
}

/** Produits mis en avant (accueil). */
export async function featuredProducts(client: Db, scopeIds: readonly string[], limit: number): Promise<ProductCard[]> {
  const base = filteredProducts({ scopeIds, featuredOnly: true, sort: "nouveautes" });
  const rows = await client.$queryRaw<ProductCardRow[]>`
    SELECT f.*, ${WITH_IMAGE} FROM (
      SELECT * FROM (${base}) page ORDER BY ${ORDER_BY.nouveautes} LIMIT ${limit}
    ) f ORDER BY ${ORDER_BY.nouveautes}`;
  return rows.map(toCard);
}

/** Marques présentes dans le périmètre (filtre « marque »). */
export async function brandsInScope(client: Db, scopeIds: readonly string[]): Promise<{ slug: string; name: string }[]> {
  return client.brand.findMany({
    where: { products: { some: { status: "PUBLISHED", categoryId: { in: [...scopeIds] } } } },
    orderBy: { name: "asc" },
    select: { slug: true, name: true },
  });
}

// ─── Fiche produit ───────────────────────────────────────────────────────────

/** Un produit n'est présenté au public que publié et avec au moins une variante active. */
const LISTABLE_PRODUCT = { status: "PUBLISHED", variants: { some: { isActive: true } } } as const;

const specsSchema = z.array(z.object({ label: z.string(), value: z.string() })).catch([]);
const attributesSchema = z.record(z.string(), z.string()).catch({});

export interface ProductVariantView {
  sku: string;
  name: string;
  attributes: Record<string, string>;
  price: number;
  compareAtPrice: number | null;
  available: number;
  isDefault: boolean;
}

export interface ProductDetail {
  slug: string;
  name: string;
  model: string | null;
  shortDescription: string;
  description: string;
  condition: ProductCondition;
  warrantyMonths: number | null;
  warrantyText: string | null;
  specs: { label: string; value: string }[];
  weightGrams: number | null;
  dimensions: string | null;
  seoTitle: string | null;
  seoDescription: string | null;
  updatedAt: Date;
  brand: { name: string; slug: string } | null;
  categoryId: string;
  images: { url: string; alt: string }[];
  variants: ProductVariantView[];
  available: number;
  compatible: { slug: string; name: string }[];
}

/**
 * Fiche publique d'un produit publié, dans une catégorie visible. Sélection explicite :
 * prix d'achat, marges et notes internes ne sont jamais lus.
 */
export async function getProductDetail(client: Db, index: CategoryIndex, slug: string): Promise<ProductDetail | null> {
  if (!isValidSlug(slug)) return null;
  const product = await client.product.findFirst({
    where: { slug, status: "PUBLISHED" },
    select: {
      slug: true,
      name: true,
      model: true,
      shortDescription: true,
      description: true,
      condition: true,
      warrantyMonths: true,
      warrantyText: true,
      specs: true,
      weightGrams: true,
      dimensions: true,
      seoTitle: true,
      seoDescription: true,
      updatedAt: true,
      categoryId: true,
      brand: { select: { name: true, slug: true } },
      images: { orderBy: { position: "asc" }, select: { url: true, alt: true } },
      variants: {
        where: { isActive: true },
        orderBy: [{ isDefault: "desc" }, { position: "asc" }],
        select: {
          sku: true,
          name: true,
          attributes: true,
          price: true,
          compareAtPrice: true,
          isDefault: true,
          inventory: { select: { onHand: true, reserved: true } },
        },
      },
      compatibleWith: {
        where: { compatibleProduct: LISTABLE_PRODUCT },
        select: { compatibleProduct: { select: { slug: true, name: true, categoryId: true } } },
      },
    },
  });
  if (!product || !index.byId.has(product.categoryId) || product.variants.length === 0) return null;

  const variants = product.variants.map(({ inventory, attributes, ...variant }) => ({
    ...variant,
    attributes: attributesSchema.parse(attributes),
    available: Math.max(0, (inventory?.onHand ?? 0) - (inventory?.reserved ?? 0)),
  }));
  const { compatibleWith, specs, ...rest } = product;
  return {
    ...rest,
    specs: specsSchema.parse(specs),
    variants,
    available: variants.reduce((sum, variant) => sum + variant.available, 0),
    compatible: compatibleWith
      .map(({ compatibleProduct }) => compatibleProduct)
      .filter((related) => index.byId.has(related.categoryId))
      .map(({ slug: relatedSlug, name }) => ({ slug: relatedSlug, name })),
  };
}

/** Produits publiés pour le sitemap. */
export async function listProductsForSitemap(
  client: Db,
  index: CategoryIndex,
): Promise<{ slug: string; updatedAt: Date }[]> {
  return client.product.findMany({
    where: { ...LISTABLE_PRODUCT, categoryId: { in: [...index.byId.keys()] } },
    select: { slug: true, updatedAt: true },
  });
}
