import "server-only";
import type { PrismaClient } from "@/generated/prisma/client";
import { assertPermission, type Actor } from "@/server/authz/service";
import { reviewSocialLinksInput } from "@/lib/social-links";
import { AppError, ValidationError } from "@/server/errors";
import { discardStoredFile, storeLogo } from "@/server/storage/logo-upload";
import type { FileStorage } from "@/server/storage/storage";
import { fieldErrorsOf, parseInput } from "@/server/validation";
import { companySettingsInputSchema, settingsSchemas, type SettingKey, type SettingValue } from "./schemas";
import { getSetting, modifySetting, updateSetting } from "./service";

/**
 * Paramètres modifiables par l'écran « Paramètres » (settings.manage). Le bandeau d'annonces en est
 * exclu : il relève de announcements.manage, réservée à l'administrateur principal.
 */
export type EditableSettingKey = Exclude<SettingKey, "announcements">;

const SETTING_LABELS: Record<EditableSettingKey, string> = {
  company: "Identité et mentions légales",
  commerce: "Commande et paiement",
  payments: "Moyens de règlement",
  tax: "TVA",
  features: "Fonctions",
  businessHours: "Heures ouvrables et jours fériés",
  returnReminders: "Relances des vérifications",
};

/** Paramètres modifiables par écran : tous, sauf la devise et le fuseau (imposés par le schéma). */
export const EDITABLE_SETTING_KEYS = Object.keys(SETTING_LABELS) as EditableSettingKey[];

export function isSettingKey(value: unknown): value is EditableSettingKey {
  return typeof value === "string" && (EDITABLE_SETTING_KEYS as string[]).includes(value);
}

/** Tous les paramètres pour l'écran d'administration (settings.manage). */
export async function getAllSettings(client: PrismaClient, actor: Actor): Promise<{ [K in EditableSettingKey]: SettingValue<K> }> {
  await assertPermission(client, actor, "settings.manage");
  const values = await Promise.all(EDITABLE_SETTING_KEYS.map(async (key) => [key, await getSetting(key, client)] as const));
  return Object.fromEntries(values) as { [K in EditableSettingKey]: SettingValue<K> };
}

/**
 * Enregistre un groupe de paramètres (settings.manage) : validé par son schéma Zod strict (erreurs
 * rattachées à chaque champ), audité avant/après dans la même transaction.
 */
export async function saveSettings<K extends EditableSettingKey>(client: PrismaClient, actor: Actor, key: K, input: unknown): Promise<SettingValue<K>> {
  // Garde d'exécution (le typage ne suffit pas) : jamais d'écriture du bandeau d'annonces par ce circuit.
  if (!isSettingKey(key)) throw new AppError("FORBIDDEN", "Ce paramètre ne se modifie pas depuis cet écran.");
  await assertPermission(client, actor, "settings.manage");
  if (key === "company") return (await saveCompany(client, actor, input)) as SettingValue<K>;
  return updateSetting(key, parseInput(settingsSchemas[key], input, SETTING_LABELS[key]), actor.id, client);
}

/**
 * Identité : champs validés par companySettingsInputSchema, liens sociaux comparés à la valeur
 * enregistrée (reviewSocialLinksInput : un ancien lien non conforme laissé tel quel ne bloque pas
 * l'enregistrement, un lien modifié doit être conforme). Toutes les erreurs sont renvoyées ensemble.
 * Le logo ne se change pas par l'identité (décision 4 : téléversement uniquement) : la valeur
 * enregistrée est conservée. `stored` est la valeur lue sous verrou (modifySetting).
 */
function companyValue(input: unknown, stored: SettingValue<"company">): SettingValue<"company"> {
  const submitted = typeof input === "object" && input !== null ? { ...input, logoUrl: stored.logoUrl } : input;
  const parsed = companySettingsInputSchema.safeParse(submitted);
  // Liens contrôlés même si un autre champ est en erreur : toutes les erreurs sont affichées en une fois.
  const links = companySettingsInputSchema.shape.socialLinks.safeParse((submitted as { socialLinks?: unknown } | null)?.socialLinks);
  const review = links.success ? reviewSocialLinksInput(links.data, stored.socialLinks) : null;
  const fieldErrors = { ...(parsed.success ? {} : fieldErrorsOf(parsed.error)), ...review?.fieldErrors };
  if (!parsed.success || !review || Object.keys(fieldErrors).length > 0) {
    throw new ValidationError(`${SETTING_LABELS.company} invalide`, { fieldErrors });
  }
  return { ...parsed.data, socialLinks: review.links };
}

async function saveCompany(client: PrismaClient, actor: Actor, input: unknown): Promise<SettingValue<"company">> {
  // Contrôle préalable hors verrou (une saisie invalide n'obtient pas le verrou), puis contrôle définitif
  // sous verrou : la comparaison « lien inchangé » porte sur la valeur réellement enregistrée.
  companyValue(input, await getSetting("company", client));
  return modifySetting("company", (current) => companyValue(input, current), actor.id, client);
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

/** Revient au logo officiel FUTANI SHOP. */
export async function removeLogo(client: PrismaClient, actor: Actor): Promise<void> {
  await assertPermission(client, actor, "settings.manage");
  const company = await getSetting("company", client);
  if (company.logoUrl === null) throw new AppError("CONFLICT", "Aucun logo à retirer.");
  // Audité par updateSetting (avant/après).
  await updateSetting("company", { ...company, logoUrl: null }, actor.id, client);
}
