import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { ProductListing } from "@/components/catalog/product-listing";
import { Breadcrumbs } from "@/components/layout/breadcrumbs";
import { db } from "@/server/db/client";
import { parseListingParams } from "@/server/modules/catalog/listing-params";
import { brandsInScope, categoryPath, descendantIds, searchProducts } from "@/server/modules/catalog/queries";
import { getCategoryIndex } from "@/server/storefront";

interface Props {
  params: Promise<{ slug: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { slug } = await params;
  const category = (await getCategoryIndex()).bySlug.get(slug);
  if (!category) return {};
  return {
    title: category.seoTitle ?? category.name,
    description: category.seoDescription ?? category.description ?? `${category.name} : prix en FCFA, stock réel, paiement en espèces.`,
    alternates: { canonical: `/categories/${category.slug}` },
  };
}

export default async function CategoryPage({ params, searchParams }: Props) {
  const [{ slug }, raw, index] = await Promise.all([params, searchParams, getCategoryIndex()]);
  const category = index.bySlug.get(slug);
  if (!category) notFound();

  const listing = parseListingParams(raw);
  const scope = descendantIds(index, category.id);
  const [result, brands] = await Promise.all([searchProducts(db, scope, listing), brandsInScope(db, scope)]);
  const subcategories = index.children.get(category.id) ?? [];
  const basePath = `/categories/${category.slug}`;

  return (
    <main className="mx-auto flex max-w-6xl flex-col gap-6 px-4 py-6">
      <Breadcrumbs items={categoryPath(index, category.id).map((node) => ({ label: node.name, href: `/categories/${node.slug}` }))} />
      <header>
        <h1 className="text-2xl font-bold">{category.name}</h1>
        {category.description && <p className="mt-2 text-ink-muted">{category.description}</p>}
      </header>
      {subcategories.length > 0 && (
        <nav aria-label="Sous-catégories">
          <ul className="flex flex-wrap gap-2">
            {subcategories.map((child) => (
              <li key={child.id}>
                <Link
                  href={`/categories/${child.slug}`}
                  className="inline-flex rounded-full border border-line bg-surface px-3 py-1.5 text-sm hover:border-brand-blue"
                >
                  {child.name}
                </Link>
              </li>
            ))}
          </ul>
        </nav>
      )}
      <ProductListing basePath={basePath} params={listing} result={result} brands={brands} />
    </main>
  );
}
