import "server-only";
import type { PrismaClient } from "@/generated/prisma/client";
import { slugify } from "@/lib/slug";
import { INFORMATION_PAGES, PRODUCT_CATEGORIES, SERVICE_CATEGORIES } from "./taxonomy";

export interface CatalogSeedResult {
  categoriesCreated: number;
  servicesCreated: number;
  pagesCreated: number;
}

const DRAFT_PAGE_BODY = "Contenu en cours de rédaction par SYSTELEC.";
const SERVICE_DESCRIPTION =
  "Prestation réalisée par l'équipe technique SYSTELEC. Le tarif est établi sur devis après étude de votre besoin.";

async function seedProductCategories(client: PrismaClient): Promise<number> {
  let created = 0;
  for (const [familyIndex, family] of PRODUCT_CATEGORIES.entries()) {
    const slug = slugify(family.name);
    let parent = await client.category.findUnique({ where: { slug }, select: { id: true } });
    if (!parent) {
      parent = await client.category.create({
        data: { name: family.name, slug, position: familyIndex },
        select: { id: true },
      });
      created += 1;
    }
    const children = await client.category.createMany({
      data: family.children.map((name, position) => ({ name, slug: slugify(name), parentId: parent.id, position })),
      skipDuplicates: true,
    });
    created += children.count;
  }
  return created;
}

async function seedServices(client: PrismaClient): Promise<number> {
  let created = 0;
  for (const [index, group] of SERVICE_CATEGORIES.entries()) {
    const slug = slugify(group.name);
    const category =
      (await client.serviceCategory.findUnique({ where: { slug }, select: { id: true } })) ??
      (await client.serviceCategory.create({
        data: { name: group.name, slug, description: group.description, position: index },
        select: { id: true },
      }));
    const services = await client.service.createMany({
      data: group.services.map((name, position) => ({
        categoryId: category.id,
        name,
        slug: slugify(name),
        shortDescription: `${name} par SYSTELEC.`,
        description: SERVICE_DESCRIPTION,
        pricingMode: "QUOTE_ONLY" as const,
        position,
      })),
      skipDuplicates: true,
    });
    created += services.count;
  }
  return created;
}

/**
 * Crée la structure de base manquante (catégories §6, services §7, pages en brouillon).
 * N'écrase jamais un élément existant : les modifications de l'administration sont préservées.
 */
export async function seedBaseCatalog(client: PrismaClient): Promise<CatalogSeedResult> {
  const categoriesCreated = await seedProductCategories(client);
  const servicesCreated = await seedServices(client);
  const pages = await client.page.createMany({
    data: INFORMATION_PAGES.map((page) => ({ ...page, body: DRAFT_PAGE_BODY, isPublished: false })),
    skipDuplicates: true,
  });
  return { categoriesCreated, servicesCreated, pagesCreated: pages.count };
}
