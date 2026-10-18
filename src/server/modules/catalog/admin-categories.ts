import "server-only";
import { Prisma, type PrismaClient } from "@/generated/prisma/client";
import { recordAudit } from "@/server/audit/audit";
import { assertPermission, type Actor } from "@/server/authz/service";
import type { Db } from "@/server/db/client";
import { AppError } from "@/server/errors";
import { parseInput } from "@/server/validation";
import { categoryInputSchema } from "./admin-schemas";

const MAX_DEPTH = 20;

const parseCategory = (input: unknown) => parseInput(categoryInputSchema, input, "Catégorie");

function slugConflict(error: unknown): never {
  if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002") {
    throw new AppError("CONFLICT", "Cet identifiant d'URL est déjà utilisé par une autre catégorie.");
  }
  throw error;
}

/** Refuse un parent inexistant, ou un parent qui créerait une boucle dans l'arborescence. */
async function assertValidParent(client: Db, categoryId: string | null, parentId: string | null): Promise<void> {
  let current = parentId;
  for (let depth = 0; current !== null; depth += 1) {
    if (current === categoryId) throw new AppError("CONFLICT", "Une catégorie ne peut pas être rangée sous elle-même.");
    if (depth > MAX_DEPTH) throw new AppError("CONFLICT", "Arborescence trop profonde.");
    const parent: { parentId: string | null } | null = await client.category.findUnique({
      where: { id: current },
      select: { parentId: true },
    });
    if (!parent) throw new AppError("NOT_FOUND", "Catégorie parente introuvable.");
    current = parent.parentId;
  }
}

export async function createCategory(client: PrismaClient, actor: Actor, input: unknown): Promise<{ id: string }> {
  await assertPermission(client, actor, "categories.manage");
  const data = parseCategory(input);
  await assertValidParent(client, null, data.parentId);
  return client.$transaction(async (tx) => {
    const category = await tx.category.create({ data, select: { id: true } }).catch(slugConflict);
    await recordAudit(tx, { actorId: actor.id, action: "category.create", entityType: "Category", entityId: category.id, after: data });
    return category;
  });
}

export async function updateCategory(client: PrismaClient, actor: Actor, id: string, input: unknown): Promise<void> {
  await assertPermission(client, actor, "categories.manage");
  const data = parseCategory(input);
  await client.$transaction(async (tx) => {
    // Déplacements sérialisés : deux rattachements simultanés ne peuvent pas former une boucle.
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext('category-tree'))`;
    await assertValidParent(tx, id, data.parentId);
    const before = await tx.category.findUnique({ where: { id } });
    if (!before) throw new AppError("NOT_FOUND", "Catégorie introuvable.");
    await tx.category.update({ where: { id }, data }).catch(slugConflict);
    await recordAudit(tx, { actorId: actor.id, action: "category.update", entityType: "Category", entityId: id, before, after: data });
  });
}

/** Suppression réservée aux catégories vides (ni sous-catégorie, ni produit) ; sinon, désactiver. */
export async function deleteCategory(client: PrismaClient, actor: Actor, id: string): Promise<void> {
  await assertPermission(client, actor, "categories.manage");
  await client.$transaction(async (tx) => {
    const category = await tx.category.findUnique({
      where: { id },
      include: { _count: { select: { children: true, products: true } } },
    });
    if (!category) throw new AppError("NOT_FOUND", "Catégorie introuvable.");
    if (category._count.children > 0 || category._count.products > 0) {
      throw new AppError("CONFLICT", "Cette catégorie contient des sous-catégories ou des produits : désactivez-la plutôt.");
    }
    await tx.category.delete({ where: { id } });
    await recordAudit(tx, { actorId: actor.id, action: "category.delete", entityType: "Category", entityId: id, before: category });
  });
}

export interface AdminCategoryRow {
  id: string;
  parentId: string | null;
  name: string;
  slug: string;
  position: number;
  isActive: boolean;
  productCount: number;
}

/** Toutes les catégories (actives ou non) pour l'administration. */
export async function listAdminCategories(client: Db, actor: Actor): Promise<AdminCategoryRow[]> {
  await assertPermission(client, actor, "products.read");
  const rows = await client.category.findMany({
    orderBy: [{ position: "asc" }, { name: "asc" }],
    select: {
      id: true,
      parentId: true,
      name: true,
      slug: true,
      position: true,
      isActive: true,
      _count: { select: { products: true } },
    },
  });
  return rows.map(({ _count, ...row }) => ({ ...row, productCount: _count.products }));
}

/** Catégorie à modifier (active ou non). */
export async function getAdminCategory(client: Db, actor: Actor, id: string) {
  await assertPermission(client, actor, "categories.manage");
  return client.category.findUnique({
    where: { id },
    select: {
      id: true,
      parentId: true,
      name: true,
      slug: true,
      description: true,
      position: true,
      isActive: true,
      seoTitle: true,
      seoDescription: true,
    },
  });
}
