import "server-only";
import type { PrismaClient } from "@/generated/prisma/client";
import { recordAudit } from "@/server/audit/audit";
import { assertPermission, type Actor } from "@/server/authz/service";
import type { Db } from "@/server/db/client";
import { AppError } from "@/server/errors";
import { discardStoredFile, storeLogo } from "@/server/storage/logo-upload";
import type { FileStorage } from "@/server/storage/storage";
import { parseInput } from "@/server/validation";
import { partnerSchema } from "./schemas";

export interface AdminPartner {
  id: string;
  name: string;
  websiteUrl: string | null;
  logoUrl: string;
  isActive: boolean;
  position: number;
  updatedAt: Date;
}

const PARTNER_SELECT = { id: true, name: true, websiteUrl: true, logoUrl: true, isActive: true, position: true, updatedAt: true } as const;

/** Tous les partenaires, actifs ou non, dans l'ordre d'affichage (content.manage). */
export async function listAdminPartners(client: Db, actor: Actor): Promise<AdminPartner[]> {
  await assertPermission(client, actor, "content.manage");
  return client.partner.findMany({ orderBy: [{ position: "asc" }, { name: "asc" }], select: PARTNER_SELECT });
}

/** Enregistre le logo téléversé, puis exécute l'écriture ; le fichier est retiré si elle échoue. */
async function withUploadedLogo<T>(storage: FileStorage, logo: Uint8Array, write: (logoUrl: string) => Promise<T>): Promise<T> {
  const { key, url } = await storeLogo(storage, "partenaires", "partenaire", logo, "logo");
  try {
    return await write(url);
  } catch (error) {
    await discardStoredFile(storage, key);
    throw error;
  }
}

/**
 * Ajoute un partenaire (content.manage) : nom, site https facultatif, ordre, actif ou non, et logo
 * TÉLÉVERSÉ obligatoire (PNG, JPEG ou WebP vérifié sur son contenu, 1 Mo au plus). Audité.
 */
export async function createPartner(client: PrismaClient, storage: FileStorage, actor: Actor, input: unknown, logo: Uint8Array): Promise<{ id: string }> {
  await assertPermission(client, actor, "content.manage");
  const data = parseInput(partnerSchema, input, "Partenaire");
  return withUploadedLogo(storage, logo, (logoUrl) =>
    client.$transaction(async (tx) => {
      const created = await tx.partner.create({ data: { ...data, websiteUrl: data.websiteUrl ?? null, logoUrl }, select: { id: true } });
      await recordAudit(tx, { actorId: actor.id, action: "partner.create", entityType: "Partner", entityId: created.id, after: { ...data, logoUrl } });
      return created;
    }),
  );
}

/**
 * Modifie un partenaire (content.manage) : fiche, activation, ordre, et logo remplacé s'il est fourni
 * (l'ancien fichier reste stocké, comme pour le logo du site : traçabilité de l'audit). Audité avant/après.
 */
export async function updatePartner(client: PrismaClient, storage: FileStorage, actor: Actor, id: string, input: unknown, logo: Uint8Array | null): Promise<void> {
  await assertPermission(client, actor, "content.manage");
  const data = parseInput(partnerSchema, input, "Partenaire");
  const write = (logoUrl: string | null) =>
    client.$transaction(async (tx) => {
      const before = await tx.partner.findUnique({ where: { id }, select: PARTNER_SELECT });
      if (!before) throw new AppError("NOT_FOUND", "Partenaire introuvable.");
      const changes = { ...data, websiteUrl: data.websiteUrl ?? null, ...(logoUrl && { logoUrl }) };
      await tx.partner.update({ where: { id }, data: changes });
      await recordAudit(tx, { actorId: actor.id, action: "partner.update", entityType: "Partner", entityId: id, before, after: changes });
    });
  if (logo && logo.byteLength > 0) await withUploadedLogo(storage, logo, write);
  else await write(null);
}

/** Supprime un partenaire (content.manage) ; sa fiche reste dans l'audit. */
export async function deletePartner(client: PrismaClient, actor: Actor, id: string): Promise<void> {
  await assertPermission(client, actor, "content.manage");
  await client.$transaction(async (tx) => {
    const before = await tx.partner.findUnique({ where: { id }, select: PARTNER_SELECT });
    if (!before) throw new AppError("NOT_FOUND", "Partenaire introuvable.");
    await tx.partner.delete({ where: { id } });
    await recordAudit(tx, { actorId: actor.id, action: "partner.delete", entityType: "Partner", entityId: id, before });
  });
}
