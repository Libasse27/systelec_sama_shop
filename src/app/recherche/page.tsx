import type { Metadata } from "next";
import Link from "next/link";
import { ProductListing } from "@/components/catalog/product-listing";
import { db } from "@/server/db/client";
import { parseListingParams } from "@/server/modules/catalog/listing-params";
import { brandsInScope, searchProducts } from "@/server/modules/catalog/queries";
import { getCategoryIndex } from "@/server/storefront";

interface Props {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}

export async function generateMetadata({ searchParams }: Props): Promise<Metadata> {
  const { q } = parseListingParams(await searchParams);
  // Les pages de résultats ne sont pas indexées (contenu dupliqué, combinaisons infinies).
  return { title: q ? `Recherche : ${q}` : "Recherche", robots: { index: false, follow: true } };
}

export default async function SearchPage({ searchParams }: Props) {
  const [raw, index] = await Promise.all([searchParams, getCategoryIndex()]);
  const params = parseListingParams(raw);
  const scope = [...index.byId.keys()];
  const [result, brands] = await Promise.all([searchProducts(db, scope, params), brandsInScope(db, scope)]);

  return (
    <main className="mx-auto flex max-w-6xl flex-col gap-6 px-4 py-6">
      <header>
        <h1 className="text-2xl font-bold">{params.q ? `Résultats pour « ${params.q} »` : "Tous les produits"}</h1>
        {params.q && result.total === 0 && (
          <p className="mt-2 text-ink-muted">
            Essayez un autre mot (nom, marque, référence) ou{" "}
            <Link href="/contact" className="text-brand-blue underline">
              demandez-nous conseil
            </Link>
            .
          </p>
        )}
      </header>
      <ProductListing basePath="/recherche" params={params} result={result} brands={brands} />
    </main>
  );
}
