import "server-only";
import { randomUUID } from "node:crypto";
import { ValidationError } from "@/server/errors";
import { logger } from "@/server/logger";
import { detectImageType } from "./image-type";
import { mediaUrl, type FileStorage } from "./storage";

/** Taille maximale d'un logo (logo du site, logos des partenaires). */
export const MAX_LOGO_BYTES = 1024 * 1024;

/**
 * Enregistre un logo TÉLÉVERSÉ (décision 4 : aucun logo externe) : PNG, JPEG ou WebP vérifié sur
 * son contenu (jamais sur l'extension ni le type annoncé), 1 Mo au plus, nom aléatoire. Renvoie
 * l'adresse publique (/medias/<dossier>/<préfixe>-<uuid>.<ext>). `field` rattache l'erreur au champ.
 */
export async function storeLogo(storage: FileStorage, folder: string, prefix: string, bytes: Uint8Array, field: string): Promise<{ key: string; url: string }> {
  if (bytes.byteLength === 0) throw new ValidationError("Choisissez une image.", { fieldErrors: { [field]: ["Fichier vide"] } });
  if (bytes.byteLength > MAX_LOGO_BYTES) throw new ValidationError("Logo trop lourd.", { fieldErrors: { [field]: ["1 Mo maximum"] } });
  const extension = detectImageType(bytes);
  if (!extension) throw new ValidationError("Format d'image refusé.", { fieldErrors: { [field]: ["Formats acceptés : PNG, JPEG, WebP"] } });
  const key = `${folder}/${prefix}-${randomUUID()}.${extension}`;
  await storage.put(key, bytes);
  return { key, url: mediaUrl(key) };
}

/** Retire un fichier téléversé devenu orphelin (enregistrement en base refusé). Ne lève jamais. */
export async function discardStoredFile(storage: FileStorage, key: string): Promise<void> {
  await storage.remove(key).catch((error: unknown) => {
    logger.warn("Fichier orphelin non supprimé", { key, error: error instanceof Error ? error.message : "inconnue" });
  });
}
