import "server-only";
import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { getServerEnv } from "@/lib/env";
import { AppError } from "@/server/errors";

/** Préfixe public des fichiers servis par src/app/medias/[...key]/route.ts. */
export const MEDIA_URL_PREFIX = "/medias/";

/** Clés générées par l'application uniquement : segments en minuscules, extension d'image. */
const KEY_PATTERN = /^(?:[a-z0-9][a-z0-9-]{0,63}\/){0,3}[a-z0-9][a-z0-9-]{0,63}\.(?:jpg|png|webp)$/;

export function isValidStorageKey(key: string): boolean {
  return KEY_PATTERN.test(key);
}

export interface FileStorage {
  put(key: string, bytes: Uint8Array): Promise<void>;
  /** Contenu du fichier, ou null s'il n'existe pas. */
  read(key: string): Promise<Buffer | null>;
  remove(key: string): Promise<void>;
}

/** Stockage sur le disque local (un volume sauvegardé en production). */
export function createLocalStorage(rootDir: string): FileStorage {
  const root = path.resolve(rootDir);
  const resolve = (key: string): string => {
    if (!isValidStorageKey(key)) throw new AppError("VALIDATION", "Clé de fichier invalide.");
    const fullPath = path.resolve(root, key);
    if (!fullPath.startsWith(`${root}${path.sep}`)) throw new AppError("VALIDATION", "Clé de fichier invalide.");
    return fullPath;
  };
  return {
    async put(key, bytes) {
      const fullPath = resolve(key);
      await mkdir(path.dirname(fullPath), { recursive: true });
      await writeFile(fullPath, bytes, { flag: "wx" });
    },
    async read(key) {
      try {
        return await readFile(resolve(key));
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code === "ENOENT") return null;
        throw error;
      }
    },
    async remove(key) {
      await rm(resolve(key), { force: true });
    },
  };
}

let storage: FileStorage | undefined;

/** Stockage configuré (STORAGE_DRIVER). Le pilote S3 n'est pas encore fourni : échec explicite. */
export function getStorage(): FileStorage {
  if (storage) return storage;
  const env = getServerEnv();
  if (env.STORAGE_DRIVER !== "local") {
    throw new AppError("INTERNAL", "Le stockage S3 n'est pas encore disponible : utilisez STORAGE_DRIVER=local.");
  }
  storage = createLocalStorage(env.STORAGE_LOCAL_DIR);
  return storage;
}

export const mediaUrl = (key: string): string => `${MEDIA_URL_PREFIX}${key}`;

/** Clé d'un fichier géré par l'application, ou null pour une URL externe. */
export function keyFromMediaUrl(url: string): string | null {
  if (!url.startsWith(MEDIA_URL_PREFIX)) return null;
  const key = url.slice(MEDIA_URL_PREFIX.length);
  return isValidStorageKey(key) ? key : null;
}
