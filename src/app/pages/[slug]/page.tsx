import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { cache } from "react";
import { Breadcrumbs } from "@/components/layout/breadcrumbs";
import { formatDate } from "@/lib/dates";
import { db } from "@/server/db/client";
import { getPublishedPage, toParagraphs } from "@/server/modules/content/queries";

interface Props {
  params: Promise<{ slug: string }>;
}

const loadPage = cache((slug: string) => getPublishedPage(db, slug));

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const page = await loadPage((await params).slug);
  if (!page) return {};
  return {
    title: page.title,
    description: page.seoDescription ?? undefined,
    alternates: { canonical: `/pages/${page.slug}` },
  };
}

export default async function InformationPage({ params }: Props) {
  const page = await loadPage((await params).slug);
  if (!page) notFound();
  return (
    <main className="mx-auto flex max-w-3xl flex-col gap-6 px-4 py-6">
      <Breadcrumbs items={[{ label: page.title, href: `/pages/${page.slug}` }]} />
      <article className="flex flex-col gap-4">
        <h1 className="text-2xl font-bold">{page.title}</h1>
        {toParagraphs(page.body).map((paragraph, i) => (
          <p key={`${i}-${paragraph.slice(0, 20)}`} className="whitespace-pre-line">
            {paragraph}
          </p>
        ))}
        <p className="text-sm text-ink-muted">Mis à jour le {formatDate(page.updatedAt)}.</p>
      </article>
    </main>
  );
}
