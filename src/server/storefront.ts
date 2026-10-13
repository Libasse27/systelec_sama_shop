import "server-only";
import { cache } from "react";
import { getServerEnv } from "@/lib/env";
import { db } from "@/server/db/client";
import { loadCategoryIndex } from "@/server/modules/catalog/queries";

/** Index des catégories visibles, chargé une seule fois par requête. */
export const getCategoryIndex = cache(() => loadCategoryIndex(db));

/** URL absolue publique (canonique, sitemap, données structurées). */
export function absoluteUrl(path: string): string {
  return `${getServerEnv().APP_URL}${path.startsWith("/") ? path : `/${path}`}`;
}
