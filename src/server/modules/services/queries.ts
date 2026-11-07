import "server-only";
import type { Prisma, ServicePricingMode } from "@/generated/prisma/client";
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

const groupSelect = {
  slug: true,
  name: true,
  description: true,
  services: { where: { isActive: true }, orderBy: [{ position: "asc" }, { name: "asc" }], select: summarySelect },
} satisfies Prisma.ServiceCategorySelect;

/** Familles de services actives et leurs prestations actives (page « Services »). */
export async function listServiceGroups(client: Db): Promise<ServiceGroup[]> {
  const groups = await client.serviceCategory.findMany({
    where: { isActive: true },
    orderBy: [{ position: "asc" }, { name: "asc" }],
    select: groupSelect,
  });
  return groups.filter((group) => group.services.length > 0);
}

/** Familles actives ayant au moins une prestation active, nom et slug seulement (menu du navbar FUTANI TECH). */
export async function listServiceFamilyLinks(client: Db): Promise<{ slug: string; name: string }[]> {
  return client.serviceCategory.findMany({
    where: { isActive: true, services: { some: { isActive: true } } },
    orderBy: [{ position: "asc" }, { name: "asc" }],
    select: { slug: true, name: true },
  });
}

/** Famille active et ses prestations actives (page de famille) ; null si elle n'est pas présentable au public. */
export async function getServiceGroup(client: Db, slug: string): Promise<ServiceGroup | null> {
  if (!isValidSlug(slug)) return null;
  const group = await client.serviceCategory.findFirst({ where: { slug, isActive: true }, select: groupSelect });
  return group && group.services.length > 0 ? group : null;
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
