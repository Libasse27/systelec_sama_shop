import "server-only";
import type { Db } from "@/server/db/client";

export interface PublishedPage {
  slug: string;
  title: string;
  body: string;
  seoDescription: string | null;
  updatedAt: Date;
}

/** Page d'information publiée (les brouillons ne sont jamais servis). */
export async function getPublishedPage(client: Db, slug: string): Promise<PublishedPage | null> {
  return client.page.findFirst({
    where: { slug, isPublished: true },
    select: { slug: true, title: true, body: true, seoDescription: true, updatedAt: true },
  });
}

export async function listPublishedPages(client: Db): Promise<{ slug: string; title: string; updatedAt: Date }[]> {
  return client.page.findMany({
    where: { isPublished: true },
    orderBy: { title: "asc" },
    select: { slug: true, title: true, updatedAt: true },
  });
}

export async function listFaq(client: Db): Promise<{ question: string; answer: string }[]> {
  return client.faqItem.findMany({
    where: { isPublished: true },
    orderBy: { position: "asc" },
    select: { question: true, answer: true },
  });
}

/** Découpe un texte brut en paragraphes (aucun HTML interprété : pas d'injection possible). */
export function toParagraphs(body: string): string[] {
  return body
    .split(/\n\s*\n/)
    .map((paragraph) => paragraph.trim())
    .filter(Boolean);
}
