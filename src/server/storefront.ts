import "server-only";
import { cache } from "react";
import { getServerEnv } from "@/lib/env";
import { db } from "@/server/db/client";
import { logger } from "@/server/logger";
import { loadCategoryIndex } from "@/server/modules/catalog/queries";
import { settingsDefaults, type SettingValue } from "@/server/modules/settings/schemas";
import { selectVisible, type VisibleAnnouncement } from "@/server/modules/announcements/visibility";
import { getSetting } from "@/server/modules/settings/service";

/** Index des catégories visibles, chargé une seule fois par requête. */
export const getCategoryIndex = cache(() => loadCategoryIndex(db));

/**
 * Coordonnées de l'entreprise, lues une fois par requête. Une valeur invalide en base ne doit
 * pas rendre tout le site public indisponible : repli sur les valeurs par défaut, journalisé.
 */
export const getCompanySettings = cache(async (): Promise<SettingValue<"company">> => {
  try {
    return await getSetting("company");
  } catch (error) {
    logger.error("Paramètres de l'entreprise illisibles : valeurs par défaut affichées", {
      error: error instanceof Error ? error.message : "inconnue",
    });
    return settingsDefaults.company;
  }
});

/**
 * Annonces visibles maintenant, lues une fois par requête. Comme pour les coordonnées, une lecture en
 * erreur ne doit pas rendre le site indisponible : bandeau masqué, erreur journalisée.
 */
export const getVisibleAnnouncements = cache(async (): Promise<{ items: VisibleAnnouncement[]; rotationSeconds: number }> => {
  try {
    const value = await getSetting("announcements");
    return { items: selectVisible(value, new Date()), rotationSeconds: value.rotationSeconds };
  } catch (error) {
    logger.error("Annonces illisibles : bandeau masqué", { error: error instanceof Error ? error.message : "inconnue" });
    return { items: [], rotationSeconds: settingsDefaults.announcements.rotationSeconds };
  }
});

/** URL absolue publique (canonique, sitemap, données structurées). */
export function absoluteUrl(path: string): string {
  return `${getServerEnv().APP_URL}${path.startsWith("/") ? path : `/${path}`}`;
}
