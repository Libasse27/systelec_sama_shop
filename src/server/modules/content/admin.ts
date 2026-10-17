import "server-only";
import { z } from "zod";
import { Prisma, type PrismaClient } from "@/generated/prisma/client";
import { isValidSlug } from "@/lib/slug";
import { optionalText } from "@/lib/schema-text";
import { recordAudit } from "@/server/audit/audit";
import { assertPermission, type Actor } from "@/server/authz/service";
import type { Db } from "@/server/db/client";
import { AppError } from "@/server/errors";
import { parseInput } from "@/server/validation";

/** Longueur maximale d'une page (texte brut, paragraphes séparés par une ligne vide). */
export const MAX_PAGE_BODY = 30_000;

export const pageSchema = z.object({
  slug: z.string().trim().toLowerCase().refine(isValidSlug, "Adresse invalide : lettres minuscules, chiffres et tirets"),
  title: z.string().trim().min(2).max(160),
  body: z.string().trim().max(MAX_PAGE_BODY),
  seoDescription: optionalText(300),
  isPublished: z.boolean(),
}).refine((page) => !page.isPublished || page.body.length >= 20, { message: "Une page publiée doit avoir un texte (20 caractères au moins)", path: ["body"] });

export const faqSchema = z.object({
  question: z.string().trim().min(5).max(300),
  answer: z.string().trim().min(5).max(3_000),
  position: z.number().int().min(0).max(10_000).default(0),
  isPublished: z.boolean(),
});

export interface AdminPage {
  id: string;
  slug: string;
  title: string;
  body: string;
  seoDescription: string | null;
  isPublished: boolean;
  updatedAt: Date;
}

/** Pages d'information, publiées ou non (content.manage). */
export async function listAdminPages(client: Db, actor: Actor): Promise<AdminPage[]> {
  await assertPermission(client, actor, "content.manage");
  return client.page.findMany({ orderBy: { title: "asc" }, select: { id: true, slug: true, title: true, body: true, seoDescription: true, isPublished: true, updatedAt: true } });
}

export async function listAdminFaq(client: Db, actor: Actor) {
  await assertPermission(client, actor, "content.manage");
  return client.faqItem.findMany({ orderBy: [{ position: "asc" }, { id: "asc" }] });
}

function slugConflict(error: unknown): never {
  if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002") throw new AppError("CONFLICT", "Cette adresse de page est déjà utilisée.");
  throw error;
}

/**
 * Crée (id absent) ou modifie une page (content.manage), avec audit avant/après. Le texte est du
 * texte brut rendu par paragraphes : aucun HTML n'est interprété (pas d'injection possible).
 */
export async function savePage(client: PrismaClient, actor: Actor, id: string | null, input: unknown): Promise<{ id: string; slug: string }> {
  await assertPermission(client, actor, "content.manage");
  const data = parseInput(pageSchema, input, "Page");
  return client.$transaction(async (tx) => {
    const before = id ? await tx.page.findUnique({ where: { id }, select: { slug: true, title: true, body: true, seoDescription: true, isPublished: true } }) : null;
    if (id && !before) throw new AppError("NOT_FOUND", "Page introuvable.");
    const saved = await (id ? tx.page.update({ where: { id }, data }) : tx.page.create({ data })).catch(slugConflict);
    await recordAudit(tx, { actorId: actor.id, action: id ? "page.update" : "page.create", entityType: "Page", entityId: saved.id, before, after: data });
    return { id: saved.id, slug: saved.slug };
  });
}

/** Crée ou modifie une question de la FAQ (content.manage). */
export async function saveFaqItem(client: PrismaClient, actor: Actor, id: string | null, input: unknown): Promise<void> {
  await assertPermission(client, actor, "content.manage");
  const data = parseInput(faqSchema, input, "Question");
  await client.$transaction(async (tx) => {
    const before = id ? await tx.faqItem.findUnique({ where: { id } }) : null;
    if (id && !before) throw new AppError("NOT_FOUND", "Question introuvable.");
    const saved = id ? await tx.faqItem.update({ where: { id }, data }) : await tx.faqItem.create({ data });
    await recordAudit(tx, { actorId: actor.id, action: id ? "faq.update" : "faq.create", entityType: "FaqItem", entityId: saved.id, before, after: data });
  });
}

/** Supprime une question (content.manage) ; son contenu reste dans l'audit. */
export async function deleteFaqItem(client: PrismaClient, actor: Actor, id: string): Promise<void> {
  await assertPermission(client, actor, "content.manage");
  await client.$transaction(async (tx) => {
    const before = await tx.faqItem.findUnique({ where: { id } });
    if (!before) throw new AppError("NOT_FOUND", "Question introuvable.");
    await tx.faqItem.delete({ where: { id } });
    await recordAudit(tx, { actorId: actor.id, action: "faq.delete", entityType: "FaqItem", entityId: id, before });
  });
}
