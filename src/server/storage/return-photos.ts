import "server-only";
import { randomUUID } from "node:crypto";
import { ValidationError } from "@/server/errors";
import { detectImageType, IMAGE_TYPES } from "./image-type";
import { discardStoredFile } from "./logo-upload";
import type { FileStorage } from "./storage";

/**
 * Photos jointes par un client à un retour (phase 10, décision 2) : 3 au plus par envoi, 2 Mo chacune,
 * JPEG, PNG ou WebP reconnus sur leur contenu (jamais sur l'extension ni le type annoncé). Contrôlé
 * aussi en base (contrainte return_attachments_file_check).
 */
export const RETURN_PHOTO_LIMITS = { perUpload: 3, maxBytes: 2 * 1024 * 1024, perReturn: 9 } as const;

export interface CheckedPhoto {
  bytes: Uint8Array;
  extension: keyof typeof IMAGE_TYPES;
}

/** Contrôle les photos AVANT tout stockage ; les champs vides (aucun fichier choisi) sont ignorés. */
export function checkReturnPhotos(files: readonly Uint8Array[]): CheckedPhoto[] {
  const photos = files.filter((bytes) => bytes.byteLength > 0);
  const refuse = (message: string) => new ValidationError(message, { fieldErrors: { photos: [message] } });
  if (photos.length > RETURN_PHOTO_LIMITS.perUpload) throw refuse(`${RETURN_PHOTO_LIMITS.perUpload} photos au plus.`);
  return photos.map((bytes) => {
    if (bytes.byteLength > RETURN_PHOTO_LIMITS.maxBytes) throw refuse("Photo trop lourde : 2 Mo au plus par photo.");
    const extension = detectImageType(bytes);
    if (!extension) throw refuse("Format refusé : photos JPEG, PNG ou WebP uniquement.");
    return { bytes, extension };
  });
}

/** Stocke les photos contrôlées dans le dossier privé du retour ; renvoie leurs références. */
export async function storeReturnPhotos(storage: FileStorage, returnId: string, photos: readonly CheckedPhoto[]): Promise<{ key: string; contentType: string; byteSize: number }[]> {
  const stored: { key: string; contentType: string; byteSize: number }[] = [];
  try {
    for (const photo of photos) {
      const key = `retours/${returnId}/photo-${randomUUID()}.${photo.extension}`;
      await storage.put(key, photo.bytes);
      stored.push({ key, contentType: IMAGE_TYPES[photo.extension], byteSize: photo.bytes.byteLength });
    }
    return stored;
  } catch (error) {
    await discardReturnPhotos(storage, stored);
    throw error;
  }
}

/** Retire des photos stockées dont l'enregistrement en base a échoué. Ne lève jamais. */
export async function discardReturnPhotos(storage: FileStorage, photos: readonly { key: string }[]): Promise<void> {
  for (const photo of photos) await discardStoredFile(storage, photo.key);
}
