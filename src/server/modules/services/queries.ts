import "server-only";
import type { ServicePricingMode } from "@/generated/prisma/client";
import { isValidSlug } from "@/lib/slug";
import type { Db } from "@/server/db/client";

export interface ServiceSummary {
  slug: string;
  name: string;
  shortDescription: string;
  pricingMode: ServicePricingMode;
  price: number | null;
}

export interface ServiceGroup {
  slug: string;
  name: string;
  description: string | null;
  services: ServiceSummary[];
}

export interface ServiceDetail extends ServiceSummary {
  description: string;
  imageUrl: string | null;
  estimatedDuration: string | null;
  zonesText: string | null;
  conditions: string | null;
  updatedAt: Date;
  category: { slug: string; name: string };
}

const summarySelect = { slug: true, name: true, shortDescription: true, pricingMode: true, price: true } as const;

/** Familles de services actives et leurs prestations actives (page « Services »). */
export async function listServiceGroups(client: Db): Promise<ServiceGroup[]> {
  const groups = await client.serviceCategory.findMany({
    where: { isActive: true },
    orderBy: [{ position: "asc" }, { name: "asc" }],
    select: {
      slug: true,
      name: true,
      description: true,
      services: { where: { isActive: true }, orderBy: [{ position: "asc" }, { name: "asc" }], select: summarySelect },
    },
  });
  return groups.filter((group) => group.services.length > 0);
}

/** Prestations mises en avant, sinon les premières de chaque famille (accueil). */
export async function featuredServices(client: Db, limit: number): Promise<ServiceSummary[]> {
  const where = { isActive: true, category: { isActive: true } };
  const featured = await client.service.findMany({
    where: { ...where, isFeatured: true },
    orderBy: { position: "asc" },
    take: limit,
    select: summarySelect,
  });
  if (featured.length > 0) return featured;
  return client.service.findMany({
    where: { ...where, position: 0 },
    orderBy: [{ category: { position: "asc" } }, { name: "asc" }],
    take: limit,
    select: summarySelect,
  });
}

export async function getServiceDetail(client: Db, slug: string): Promise<ServiceDetail | null> {
  if (!isValidSlug(slug)) return null;
  return client.service.findFirst({
    where: { slug, isActive: true, category: { isActive: true } },
    select: {
      ...summarySelect,
      description: true,
      imageUrl: true,
      estimatedDuration: true,
      zonesText: true,
      conditions: true,
      updatedAt: true,
      category: { select: { slug: true, name: true } },
    },
  });
}

export async function listServicesForSitemap(client: Db): Promise<{ slug: string; updatedAt: Date }[]> {
  return client.service.findMany({
    where: { isActive: true, category: { isActive: true } },
    select: { slug: true, updatedAt: true },
  });
}
