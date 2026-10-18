import "server-only";
import type { Prisma, ProductCondition, ProductStatus } from "@/generated/prisma/client";
import { assertPermission, type Actor } from "@/server/authz/service";
import type { Db } from "@/server/db/client";

export const ADMIN_PRODUCTS_PAGE_SIZE = 30;
const MAX_SEARCH_LENGTH = 100;
const STATUSES: readonly ProductStatus[] = ["DRAFT", "PUBLISHED", "ARCHIVED"];

export function parseStatusFilter(value: unknown): ProductStatus | undefined {
  return STATUSES.find((status) => status === value);
}

export interface AdminProductRow {
  id: string;
  name: string;
  slug: string;
  status: ProductStatus;
  category: string;
  sku: string | null;
  price: number | null;
  variantCount: number;
  onHand: number;
  available: number;
  hasImage: boolean;
  updatedAt: Date;
}

export interface AdminProductPage {
  rows: AdminProductRow[];
  total: number;
  page: number;
  pageCount: number;
}

/** Liste paginée de tous les produits (tous statuts), recherche sur nom, modèle ou SKU. */
export async function listAdminProducts(
  client: Db,
  actor: Actor,
  options: { q?: string; status?: ProductStatus; page?: number } = {},
): Promise<AdminProductPage> {
  await assertPermission(client, actor, "products.read");
  const q = options.q?.trim().slice(0, MAX_SEARCH_LENGTH);
  const where: Prisma.ProductWhereInput = {
    ...(options.status ? { status: options.status } : {}),
    ...(q
      ? {
          OR: [
            { name: { contains: q, mode: "insensitive" } },
            { model: { contains: q, mode: "insensitive" } },
            { variants: { some: { sku: { contains: q, mode: "insensitive" } } } },
          ],
        }
      : {}),
  };
  const total = await client.product.count({ where });
  const pageCount = Math.max(1, Math.ceil(total / ADMIN_PRODUCTS_PAGE_SIZE));
  const page = Math.min(Math.max(1, Math.trunc(options.page ?? 1)), pageCount);
  const products = await client.product.findMany({
    where,
    orderBy: [{ updatedAt: "desc" }, { id: "asc" }],
    skip: (page - 1) * ADMIN_PRODUCTS_PAGE_SIZE,
    take: ADMIN_PRODUCTS_PAGE_SIZE,
    select: {
      id: true,
      name: true,
      slug: true,
      status: true,
      updatedAt: true,
      category: { select: { name: true } },
      _count: { select: { images: true } },
      variants: {
        orderBy: [{ isDefault: "desc" }, { position: "asc" }],
        select: { sku: true, price: true, isActive: true, inventory: { select: { onHand: true, reserved: true } } },
      },
    },
  });
  const rows = products.map((product) => {
    const active = product.variants.filter((variant) => variant.isActive);
    const first = product.variants[0];
    return {
      id: product.id,
      name: product.name,
      slug: product.slug,
      status: product.status,
      category: product.category.name,
      sku: first?.sku ?? null,
      price: first?.price ?? null,
      variantCount: product.variants.length,
      onHand: active.reduce((sum, variant) => sum + (variant.inventory?.onHand ?? 0), 0),
      available: active.reduce((sum, v) => sum + (v.inventory ? v.inventory.onHand - v.inventory.reserved : 0), 0),
      hasImage: product._count.images > 0,
      updatedAt: product.updatedAt,
    };
  });
  return { rows, total, page, pageCount };
}

export interface AdminVariant {
  id: string;
  sku: string;
  barcode: string | null;
  name: string;
  attributes: Record<string, string>;
  price: number;
  compareAtPrice: number | null;
  costPrice: number | null;
  isDefault: boolean;
  isActive: boolean;
  onHand: number;
  reserved: number;
  alertThreshold: number;
}

export interface AdminProduct {
  id: string;
  categoryId: string;
  brandName: string | null;
  name: string;
  slug: string;
  model: string | null;
  shortDescription: string;
  description: string;
  condition: ProductCondition;
  warrantyMonths: number | null;
  warrantyText: string | null;
  specs: { label: string; value: string }[];
  weightGrams: number | null;
  dimensions: string | null;
  isFeatured: boolean;
  seoTitle: string | null;
  seoDescription: string | null;
  status: ProductStatus;
  publishedAt: Date | null;
  images: { id: string; url: string; alt: string }[];
  variants: AdminVariant[];
}

const asSpecs = (value: Prisma.JsonValue): AdminProduct["specs"] =>
  Array.isArray(value)
    ? value.flatMap((item) =>
        item && typeof item === "object" && !Array.isArray(item) && typeof item.label === "string" && typeof item.value === "string"
          ? [{ label: item.label, value: item.value }]
          : [],
      )
    : [];

const asAttributes = (value: Prisma.JsonValue): Record<string, string> =>
  value && typeof value === "object" && !Array.isArray(value)
    ? Object.fromEntries(Object.entries(value).filter((entry): entry is [string, string] => typeof entry[1] === "string"))
    : {};

/** Fiche complète pour l'édition ; le prix d'achat n'est renvoyé qu'à qui peut modifier les produits. */
export async function getAdminProduct(client: Db, actor: Actor, id: string): Promise<AdminProduct | null> {
  await assertPermission(client, actor, "products.read");
  const product = await client.product.findUnique({
    where: { id },
    include: {
      brand: { select: { name: true } },
      images: { orderBy: [{ position: "asc" }, { id: "asc" }], select: { id: true, url: true, alt: true } },
      variants: { orderBy: [{ position: "asc" }, { id: "asc" }], include: { inventory: true } },
    },
  });
  if (!product) return null;
  const canSeeCost = actor.permissions.has("products.update");
  return {
    id: product.id,
    categoryId: product.categoryId,
    brandName: product.brand?.name ?? null,
    name: product.name,
    slug: product.slug,
    model: product.model,
    shortDescription: product.shortDescription,
    description: product.description,
    condition: product.condition,
    warrantyMonths: product.warrantyMonths,
    warrantyText: product.warrantyText,
    specs: asSpecs(product.specs),
    weightGrams: product.weightGrams,
    dimensions: product.dimensions,
    isFeatured: product.isFeatured,
    seoTitle: product.seoTitle,
    seoDescription: product.seoDescription,
    status: product.status,
    publishedAt: product.publishedAt,
    images: product.images,
    variants: product.variants.map((variant) => ({
      id: variant.id,
      sku: variant.sku,
      barcode: variant.barcode,
      name: variant.name,
      attributes: asAttributes(variant.attributes),
      price: variant.price,
      compareAtPrice: variant.compareAtPrice,
      costPrice: canSeeCost ? variant.costPrice : null,
      isDefault: variant.isDefault,
      isActive: variant.isActive,
      onHand: variant.inventory?.onHand ?? 0,
      reserved: variant.inventory?.reserved ?? 0,
      alertThreshold: variant.inventory?.alertThreshold ?? 0,
    })),
  };
}
