import type { MetadataRoute } from "next";
import { db } from "@/server/db/client";
import { listProductsForSitemap } from "@/server/modules/catalog/queries";
import { listPublishedPages } from "@/server/modules/content/queries";
import { listServicesForSitemap } from "@/server/modules/services/queries";
import { absoluteUrl, getCategoryIndex } from "@/server/storefront";

export const dynamic = "force-dynamic";

/** Sitemap : uniquement le contenu public visible (aucun brouillon, aucune page privée). */
export default async function sitemap(): Promise<MetadataRoute.Sitemap> {
  const index = await getCategoryIndex();
  const [products, services, pages] = await Promise.all([
    listProductsForSitemap(db, index),
    listServicesForSitemap(db),
    listPublishedPages(db),
  ]);
  return [
    { url: absoluteUrl("/"), changeFrequency: "daily", priority: 1 },
    { url: absoluteUrl("/services"), changeFrequency: "weekly", priority: 0.8 },
    { url: absoluteUrl("/faq"), changeFrequency: "monthly", priority: 0.4 },
    { url: absoluteUrl("/contact"), changeFrequency: "monthly", priority: 0.5 },
    ...[...index.byId.values()].map((category) => ({
      url: absoluteUrl(`/categories/${category.slug}`),
      lastModified: category.updatedAt,
      changeFrequency: "weekly" as const,
      priority: category.parentId ? 0.6 : 0.7,
    })),
    ...products.map((product) => ({
      url: absoluteUrl(`/produits/${product.slug}`),
      lastModified: product.updatedAt,
      priority: 0.8,
    })),
    ...services.map((service) => ({
      url: absoluteUrl(`/services/${service.slug}`),
      lastModified: service.updatedAt,
      priority: 0.6,
    })),
    ...pages.map((page) => ({ url: absoluteUrl(`/pages/${page.slug}`), lastModified: page.updatedAt, priority: 0.3 })),
  ];
}
