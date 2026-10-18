import "server-only";
import type { PrismaClient } from "@/generated/prisma/client";
import { assertPermission, type Actor } from "@/server/authz/service";
import { AppError } from "@/server/errors";
import { discardStoredFile, storeLogo } from "@/server/storage/logo-upload";
import type { FileStorage } from "@/server/storage/storage";
import { parseInput } from "@/server/validation";
import { settingsSchemas, type SettingKey, type SettingValue } from "./schemas";
import { getSetting, updateSetting } from "./service";

const SETTING_LABELS: Record<SettingKey, string> = {
  company: "Identité et mentions légales",
  commerce: "Commande et paiement",
  payments: "Moyens de règlement",
  tax: "TVA",
  features: "Fonctions",
  businessHours: "Heures ouvrables et jours fériés",
  returnReminders: "Relances des vérifications",
};

/** Paramètres modifiables par écran : tous, sauf la devise et le fuseau (imposés par le schéma). */
export const EDITABLE_SETTING_KEYS = Object.keys(SETTING_LABELS) as SettingKey[];

export function isSettingKey(value: unknown): value is SettingKey {
  return typeof value === "string" && (EDITABLE_SETTING_KEYS as string[]).includes(value);
}

/** Tous les paramètres pour l'écran d'administration (settings.manage). */
export async function getAllSettings(client: PrismaClient, actor: Actor): Promise<{ [K in SettingKey]: SettingValue<K> }> {
  await assertPermission(client, actor, "settings.manage");
  const values = await Promise.all(EDITABLE_SETTING_KEYS.map(async (key) => [key, await getSetting(key, client)] as const));
  return Object.fromEntries(values) as { [K in SettingKey]: SettingValue<K> };
}

/**
 * Enregistre un groupe de paramètres (settings.manage) : validé par son schéma Zod strict (erreurs
 * rattachées à chaque champ), audité avant/après dans la même transaction. Le logo ne se change
 * pas par l'identité (décision 4 : téléversement uniquement) : la valeur enregistrée est conservée.
 */
export async function saveSettings<K extends SettingKey>(client: PrismaClient, actor: Actor, key: K, input: unknown): Promise<SettingValue<K>> {
  await assertPermission(client, actor, "settings.manage");
  const submitted = key === "company" && typeof input === "object" && input !== null ? { ...input, logoUrl: (await getSetting("company", client)).logoUrl } : input;
  const value = parseInput(settingsSchemas[key], submitted, SETTING_LABELS[key]);
  return updateSetting(key, value, actor.id, client);
}

/**
 * Téléverse le logo (D13, décision 4) : PNG, JPEG ou WebP vérifié sur son contenu, 1 Mo au plus, nom
 * aléatoire. Le logo précédent reste stocké (traçabilité de l'audit) ; il n'est plus affiché.
 */
export async function uploadLogo(client: PrismaClient, storage: FileStorage, actor: Actor, bytes: Uint8Array): Promise<{ logoUrl: string }> {
  await assertPermission(client, actor, "settings.manage");
  const { key, url: logoUrl } = await storeLogo(storage, "identite", "logo", bytes, "logo");
  try {
    const company = await getSetting("company", client);
    await updateSetting("company", { ...company, logoUrl }, actor.id, client);
    return { logoUrl };
  } catch (error) {
    await discardStoredFile(storage, key);
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
