import "server-only";
import type { PrismaClient } from "@/generated/prisma/client";
import { aboutPageBody, BRAND } from "@/lib/brand";
import { slugify } from "@/lib/slug";
import { INFORMATION_PAGES, PRODUCT_CATEGORIES, SERVICE_CATEGORIES } from "./taxonomy";

export interface CatalogSeedResult {
  categoriesCreated: number;
  servicesCreated: number;
  pagesCreated: number;
}

const DRAFT_PAGE_BODY = `Contenu en cours de rédaction par ${BRAND.group.name}.`;
const SERVICE_DESCRIPTION = `Prestation réalisée par ${BRAND.tech.name}, ${BRAND.tech.description}. Le tarif est établi sur devis après étude de votre besoin.`;

/** Seule la page « À propos » reçoit un texte validé ; les pages légales restent à rédiger (aucun texte inventé). */
const PAGE_BODIES: Readonly<Record<string, string>> = { "a-propos": aboutPageBody() };

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
        shortDescription: `${name} par ${BRAND.tech.name}.`,
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
    data: INFORMATION_PAGES.map((page) => ({ ...page, body: PAGE_BODIES[page.slug] ?? DRAFT_PAGE_BODY, isPublished: false })),
    skipDuplicates: true,
  });
  return { categoriesCreated, servicesCreated, pagesCreated: pages.count };
}
