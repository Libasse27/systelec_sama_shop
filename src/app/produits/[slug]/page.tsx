import { Banknote, ShieldCheck } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { cache } from "react";
import { AvailabilityBadge, Price, ProductImage } from "@/components/catalog/product-card";
import { Breadcrumbs } from "@/components/layout/breadcrumbs";
import { JsonLd } from "@/components/seo/json-ld";
import { conditionLabel } from "@/lib/labels";
import { db } from "@/server/db/client";
import { toParagraphs } from "@/server/modules/content/queries";
import { categoryPath, getProductDetail, type ProductDetail } from "@/server/modules/catalog/queries";
import { absoluteUrl, getCategoryIndex } from "@/server/storefront";

interface Props {
  params: Promise<{ slug: string }>;
}

const loadProduct = cache(async (slug: string) => getProductDetail(db, await getCategoryIndex(), slug));

const SCHEMA_CONDITION = {
  NEW: "https://schema.org/NewCondition",
  REFURBISHED: "https://schema.org/RefurbishedCondition",
  USED: "https://schema.org/UsedCondition",
} as const;

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const product = await loadProduct((await params).slug);
  if (!product) return {};
  return {
    title: product.seoTitle ?? product.name,
    description: product.seoDescription ?? product.shortDescription,
    alternates: { canonical: `/produits/${product.slug}` },
    openGraph: { title: product.name, description: product.shortDescription, images: product.images.map((image) => image.url) },
  };
}

/** Données structurées Product (sans avis ni note : aucun avis n'est inventé). */
function productJsonLd(product: ProductDetail): Record<string, unknown> {
  const prices = product.variants.map((variant) => variant.price);
  return {
    "@context": "https://schema.org",
    "@type": "Product",
    name: product.name,
    description: product.shortDescription,
    sku: product.variants[0]?.sku,
    ...(product.model && { mpn: product.model }),
    ...(product.brand && { brand: { "@type": "Brand", name: product.brand.name } }),
    ...(product.images.length > 0 && { image: product.images.map((image) => image.url) }),
    itemCondition: SCHEMA_CONDITION[product.condition],
    offers: {
      "@type": "AggregateOffer",
      priceCurrency: "XOF",
      lowPrice: Math.min(...prices),
      highPrice: Math.max(...prices),
      offerCount: product.variants.length,
      availability: product.available > 0 ? "https://schema.org/InStock" : "https://schema.org/OutOfStock",
      url: absoluteUrl(`/produits/${product.slug}`),
    },
  };
}

function Specifications({ product }: { product: ProductDetail }) {
  if (product.specs.length === 0 && !product.dimensions && !product.weightGrams) return null;
  const rows = [
    ...product.specs,
    ...(product.dimensions ? [{ label: "Dimensions", value: product.dimensions }] : []),
    ...(product.weightGrams ? [{ label: "Poids", value: `${(product.weightGrams / 1000).toLocaleString("fr-SN")} kg` }] : []),
  ];
  return (
    <section aria-labelledby="caracteristiques" className="rounded-xl border border-line bg-surface p-5">
      <h2 id="caracteristiques" className="text-lg font-semibold">
        Caractéristiques techniques
      </h2>
      <dl className="mt-3 grid gap-x-6 gap-y-2 sm:grid-cols-[12rem_1fr]">
        {rows.map((row, i) => (
          <div key={`${i}-${row.label}`} className="contents">
            <dt className="text-sm text-ink-muted">{row.label}</dt>
            <dd className="text-sm">{row.value}</dd>
          </div>
        ))}
      </dl>
    </section>
  );
}

function Variants({ product }: { product: ProductDetail }) {
  if (product.variants.length < 2) return null;
  return (
    <section aria-labelledby="variantes">
      <h2 id="variantes" className="font-semibold">
        Versions disponibles
      </h2>
      <ul className="mt-2 flex flex-col gap-2">
        {product.variants.map((variant) => (
          <li key={variant.sku} className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-line bg-surface p-3">
            <span className="text-sm font-medium">{variant.name}</span>
            <span className="flex items-center gap-2">
              <Price price={variant.price} compareAtPrice={variant.compareAtPrice} />
              <AvailabilityBadge available={variant.available} />
            </span>
          </li>
        ))}
      </ul>
    </section>
  );
}

export default async function ProductPage({ params }: Props) {
  const [product, index] = await Promise.all([loadProduct((await params).slug), getCategoryIndex()]);
  if (!product) notFound();
  const main = product.variants[0]!;
  const crumbs = [
    ...categoryPath(index, product.categoryId).map((node) => ({ label: node.name, href: `/categories/${node.slug}` })),
    { label: product.name, href: `/produits/${product.slug}` },
  ];

  return (
    <main className="mx-auto flex max-w-6xl flex-col gap-6 px-4 py-6">
      <Breadcrumbs items={crumbs} />
      <div className="grid gap-6 md:grid-cols-2">
        <section aria-label="Photos" className="flex flex-col gap-3">
          <ProductImage image={product.images[0] ?? null} priority />
          {product.images.length > 1 && (
            <ul className="grid grid-cols-4 gap-2">
              {product.images.slice(1).map((image) => (
                <li key={image.url}>
                  <ProductImage image={image} />
                </li>
              ))}
            </ul>
          )}
        </section>

        <section className="flex flex-col gap-4">
          <div>
            <h1 className="text-2xl font-bold">{product.name}</h1>
            <p className="mt-1 text-sm text-ink-muted">
              {[product.brand?.name, product.model && `Modèle ${product.model}`, conditionLabel(product.condition)]
                .filter(Boolean)
                .join(" · ")}
            </p>
          </div>
          <Price price={main.price} compareAtPrice={main.compareAtPrice} size="lg" />
          <AvailabilityBadge available={product.available} />
          <p>{product.shortDescription}</p>
          <Variants product={product} />
          <div className="flex flex-col gap-2 rounded-xl bg-brand-navy p-4 text-sm text-white">
            <p className="flex items-center gap-2">
              <Banknote aria-hidden className="size-4 text-brand-accent" />
              Paiement en espèces uniquement, à la livraison ou au retrait.
            </p>
            {(product.warrantyText || product.warrantyMonths) && (
              <p className="flex items-center gap-2">
                <ShieldCheck aria-hidden className="size-4 text-brand-accent" />
                {product.warrantyText ?? `Garantie ${product.warrantyMonths} mois`}
              </p>
            )}
          </div>
          <p className="text-sm text-ink-muted">
            La commande en ligne ouvre prochainement. En attendant,{" "}
            <Link href={`/contact?produit=${product.slug}`} className="text-brand-blue underline">
              contactez-nous
            </Link>{" "}
            pour réserver ce produit.
          </p>
        </section>
      </div>

      <section aria-labelledby="description" className="rounded-xl border border-line bg-surface p-5">
        <h2 id="description" className="text-lg font-semibold">
          Description
        </h2>
        <div className="mt-2 flex flex-col gap-3">
          {toParagraphs(product.description).map((paragraph, i) => (
            <p key={`${i}-${paragraph.slice(0, 20)}`}>{paragraph}</p>
          ))}
        </div>
      </section>

      <Specifications product={product} />

      {product.compatible.length > 0 && (
        <section aria-labelledby="compatibles">
          <h2 id="compatibles" className="text-lg font-semibold">
            Accessoires compatibles
          </h2>
          <ul className="mt-2 flex flex-wrap gap-2">
            {product.compatible.map((related) => (
              <li key={related.slug}>
                <Link
                  href={`/produits/${related.slug}`}
                  className="inline-flex rounded-lg border border-line bg-surface px-3 py-2 text-sm hover:border-brand-blue"
                >
                  {related.name}
                </Link>
              </li>
            ))}
          </ul>
        </section>
      )}
      <JsonLd data={productJsonLd(product)} />
    </main>
  );
}
