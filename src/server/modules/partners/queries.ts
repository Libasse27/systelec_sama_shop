import "server-only";
import type { Db } from "@/server/db/client";
import { PARTNER_LOGO_PATTERN } from "./schemas";

export interface PublicPartner {
  id: string;
  name: string;
  websiteUrl: string | null;
  logoUrl: string;
}

/**
 * Partenaires actifs, dans l'ordre choisi, pour la boutique publique. Par prudence, un logo qui ne
 * serait pas un fichier téléversé n'est jamais rendu (la base l'interdit déjà).
 */
export async function listActivePartners(client: Db): Promise<PublicPartner[]> {
  const rows = await client.partner.findMany({
    where: { isActive: true },
    orderBy: [{ position: "asc" }, { name: "asc" }],
    select: { id: true, name: true, websiteUrl: true, logoUrl: true },
  });
  return rows.filter((row) => PARTNER_LOGO_PATTERN.test(row.logoUrl) && (row.websiteUrl === null || row.websiteUrl.startsWith("https://")));
}
