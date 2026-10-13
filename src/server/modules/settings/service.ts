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

/**
 * Valide puis enregistre un paramètre, avec audit avant/après dans la même transaction.
 * Le contrôle de la permission `settings.manage` est fait par l'appelant (Phase 3).
 */
export async function updateSetting<K extends SettingKey>(
  key: K,
  input: unknown,
  actorId: string | null,
  client: typeof defaultDb = defaultDb,
): Promise<SettingValue<K>> {
  const parsed = settingsSchemas[key].safeParse(input);
  if (!parsed.success) {
    throw new ValidationError(`Paramètres « ${key} » invalides`, z.flattenError(parsed.error as z.ZodError));
  }
  const value = parsed.data as SettingValue<K>;

  return client.$transaction(async (tx) => {
    // Sérialise les mises à jour d'une même clé pour que l'audit « avant » soit exact.
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${`settings:${key}`}))`;
    // Valeur brute : une valeur stockée devenue invalide doit rester corrigeable (et auditée telle quelle).
    const current = await tx.siteSetting.findUnique({ where: { key } });
    const before = current ? current.value : settingsDefaults[key];
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
