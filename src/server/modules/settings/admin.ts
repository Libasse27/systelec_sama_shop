import "server-only";
import { randomUUID } from "node:crypto";
import type { PrismaClient } from "@/generated/prisma/client";
import { assertPermission, type Actor } from "@/server/authz/service";
import { AppError, ValidationError } from "@/server/errors";
import { logger } from "@/server/logger";
import { detectImageType } from "@/server/storage/image-type";
import { mediaUrl, type FileStorage } from "@/server/storage/storage";
import { parseInput } from "@/server/validation";
import { settingsSchemas, type SettingKey, type SettingValue } from "./schemas";
import { getSetting, updateSetting } from "./service";

const SETTING_LABELS: Record<SettingKey, string> = {
  company: "Identité et mentions légales",
  commerce: "Commande et paiement",
  payments: "Moyens de règlement",
  tax: "TVA",
  features: "Fonctions",
};

/** Paramètres modifiables par écran : tous, sauf la devise et le fuseau (imposés par le schéma). */
export const EDITABLE_SETTING_KEYS = Object.keys(SETTING_LABELS) as SettingKey[];

export function isSettingKey(value: unknown): value is SettingKey {
  return typeof value === "string" && (EDITABLE_SETTING_KEYS as string[]).includes(value);
}

/** Tous les paramètres pour l'écran d'administration (settings.manage). */
export async function getAllSettings(client: PrismaClient, actor: Actor): Promise<{ [K in SettingKey]: SettingValue<K> }> {
  await assertPermission(client, actor, "settings.manage");
  const [company, commerce, payments, tax, features] = await Promise.all(EDITABLE_SETTING_KEYS.map((key) => getSetting(key, client)));
  return { company, commerce, payments, tax, features } as { [K in SettingKey]: SettingValue<K> };
}

/**
 * Enregistre un groupe de paramètres (settings.manage) : validé par son schéma Zod strict (erreurs
 * rattachées à chaque champ), audité avant/après dans la même transaction.
 */
export async function saveSettings<K extends SettingKey>(client: PrismaClient, actor: Actor, key: K, input: unknown): Promise<SettingValue<K>> {
  await assertPermission(client, actor, "settings.manage");
  const value = parseInput(settingsSchemas[key], input, SETTING_LABELS[key]);
  return updateSetting(key, value, actor.id, client);
}

/** Taille maximale d'un logo (le logo s'affiche sur chaque page). */
export const MAX_LOGO_BYTES = 1024 * 1024;

/**
 * Téléverse le logo (D13) : PNG, JPEG ou WebP vérifié sur son contenu, 1 Mo au plus, nom
 * aléatoire. Le logo précédent reste stocké (traçabilité de l'audit) ; il n'est plus affiché.
 */
export async function uploadLogo(client: PrismaClient, storage: FileStorage, actor: Actor, bytes: Uint8Array): Promise<{ logoUrl: string }> {
  await assertPermission(client, actor, "settings.manage");
  if (bytes.byteLength === 0) throw new ValidationError("Choisissez une image.", { fieldErrors: { logo: ["Fichier vide"] } });
  if (bytes.byteLength > MAX_LOGO_BYTES) throw new ValidationError("Logo trop lourd.", { fieldErrors: { logo: ["1 Mo maximum"] } });
  const extension = detectImageType(bytes);
  if (!extension) throw new ValidationError("Format d'image refusé.", { fieldErrors: { logo: ["Formats acceptés : PNG, JPEG, WebP"] } });
  const key = `identite/logo-${randomUUID()}.${extension}`;
  await storage.put(key, bytes);
  try {
    const company = await getSetting("company", client);
    const logoUrl = mediaUrl(key);
    await updateSetting("company", { ...company, logoUrl }, actor.id, client);
    return { logoUrl };
  } catch (error) {
    await storage.remove(key).catch((removeError: unknown) => {
      logger.warn("Logo orphelin non supprimé", { key, error: removeError instanceof Error ? removeError.message : "inconnue" });
    });
    throw error;
  }
}

/** Revient au logo typographique provisoire. */
export async function removeLogo(client: PrismaClient, actor: Actor): Promise<void> {
  await assertPermission(client, actor, "settings.manage");
  const company = await getSetting("company", client);
  if (company.logoUrl === null) throw new AppError("CONFLICT", "Aucun logo à retirer.");
  // Audité par updateSetting (avant/après).
  await updateSetting("company", { ...company, logoUrl: null }, actor.id, client);
}
