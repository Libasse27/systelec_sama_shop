import "server-only";
import { z } from "zod";
import type { Prisma } from "@/generated/prisma/client";
import { recordAudit } from "@/server/audit/audit";
import { db as defaultDb, type Db } from "@/server/db/client";
import { AppError, ValidationError } from "@/server/errors";
import { settingsDefaults, settingsSchemas, type SettingKey, type SettingValue } from "./schemas";

/** Lit un paramètre ; renvoie la valeur par défaut s'il n'a jamais été enregistré. */
export async function getSetting<K extends SettingKey>(key: K, client: Db = defaultDb): Promise<SettingValue<K>> {
  const row = await client.siteSetting.findUnique({ where: { key } });
  if (!row) return settingsDefaults[key];
  const parsed = settingsSchemas[key].safeParse(row.value);
  if (!parsed.success) {
    throw new AppError("INTERNAL", `Le paramètre « ${key} » enregistré en base est invalide`);
  }
  return parsed.data as SettingValue<K>;
}

/** Valide une valeur de paramètre (ValidationError sinon). */
function parseSetting<K extends SettingKey>(key: K, input: unknown): SettingValue<K> {
  const parsed = settingsSchemas[key].safeParse(input);
  if (!parsed.success) {
    throw new ValidationError(`Paramètres « ${key} » invalides`, z.flattenError(parsed.error as z.ZodError));
  }
  return parsed.data as SettingValue<K>;
}

/**
 * Lit-modifie-écrit un paramètre de façon atomique : la valeur courante est lue DANS la transaction,
 * après le verrou, de sorte que deux modifications simultanées s'enchaînent sans perte. `mutate`
 * reçoit la valeur courante (lecture seule, à ne pas modifier sur place) et renvoie la nouvelle
 * valeur, validée par le schéma. Audit avant/après dans la même transaction.
 * AUCUN contrôle de permission ici : il revient à l'appelant. La clé « announcements » ne doit être
 * écrite que par src/server/modules/announcements/admin.ts (announcements.manage, administrateur principal).
 * Une valeur stockée invalide n'est jamais remplacée en silence par les valeurs par défaut : sans
 * `recoverInvalid`, l'écriture échoue (INTERNAL) ; `recoverInvalid` reçoit la valeur brute et renvoie
 * la valeur de départ de `mutate` (par exemple en ne gardant que les éléments valides).
 */
export async function modifySetting<K extends SettingKey>(
  key: K,
  mutate: (current: SettingValue<K>) => unknown,
  actorId: string | null,
  client: typeof defaultDb = defaultDb,
  recoverInvalid?: (stored: unknown) => SettingValue<K>,
): Promise<SettingValue<K>> {
  return client.$transaction(async (tx) => {
    // Sérialise les mises à jour d'une même clé pour que l'audit « avant » soit exact.
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${`settings:${key}`}))`;
    // Valeur brute : une valeur stockée devenue invalide doit rester corrigeable (et auditée telle quelle).
    const row = await tx.siteSetting.findUnique({ where: { key } });
    const before = row ? row.value : settingsDefaults[key];
    const currentParsed = settingsSchemas[key].safeParse(before);
    if (!currentParsed.success && !recoverInvalid) {
      throw new AppError("INTERNAL", `Le paramètre « ${key} » enregistré en base est invalide : modification refusée pour ne rien perdre.`);
    }
    const current = (currentParsed.success ? currentParsed.data : recoverInvalid!(before)) as SettingValue<K>;
    const value = parseSetting(key, mutate(current));
    await tx.siteSetting.upsert({
      where: { key },
      create: { key, value: value as Prisma.InputJsonValue, updatedById: actorId },
      update: { value: value as Prisma.InputJsonValue, updatedById: actorId },
    });
    await recordAudit(tx, {
      actorId,
      action: "settings.update",
      entityType: "SiteSetting",
      entityId: key,
      before,
      after: value,
    });
    return value;
  });
}

/**
 * Valide puis enregistre un paramètre, avec audit avant/après dans la même transaction.
 * AUCUN contrôle de permission ici : `settings.manage` est vérifié par l'appelant (Phase 3). Ne pas
 * l'utiliser pour « announcements » en dehors de src/server/modules/announcements/admin.ts.
 * La valeur fournie remplace entièrement l'ancienne, même si celle-ci est invalide (reste corrigeable).
 */
export async function updateSetting<K extends SettingKey>(
  key: K,
  input: unknown,
  actorId: string | null,
  client: typeof defaultDb = defaultDb,
): Promise<SettingValue<K>> {
  // Validation avant d'ouvrir la transaction : une entrée invalide n'obtient pas le verrou.
  parseSetting(key, input);
  return modifySetting(key, () => input, actorId, client, () => settingsDefaults[key]);
}
