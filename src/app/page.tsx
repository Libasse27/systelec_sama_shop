import {
  Banknote,
  Cctv,
  Cpu,
  Headphones,
  Network,
  Package,
  PlugZap,
  Usb,
  Wrench,
  type LucideIcon,
} from "lucide-react";
import Link from "next/link";
import { ProductGrid } from "@/components/catalog/product-card";
import { JsonLd } from "@/components/seo/json-ld";
import { servicePriceLabel } from "@/lib/labels";
import { db } from "@/server/db/client";
import { featuredProducts } from "@/server/modules/catalog/queries";
import { featuredServices } from "@/server/modules/services/queries";
import { getSetting } from "@/server/modules/settings/service";
import { absoluteUrl, getCategoryIndex } from "@/server/storefront";

const FAMILY_ICONS: Record<string, LucideIcon> = {
  informatique: Cpu,
  "reseaux-et-telecommunications": Network,
  "electronique-grand-public": Headphones,
  "videosurveillance-et-securite": Cctv,
  "electricite-et-energie": PlugZap,
  "accessoires-et-consommables": Usb,
};

const FEATURED_PRODUCTS = 8;
const FEATURED_SERVICES = 4;

export default async function HomePage() {
  const index = await getCategoryIndex();
  const [company, products, services] = await Promise.all([
    getSetting("company"),
    featuredProducts(db, [...index.byId.keys()], FEATURED_PRODUCTS),
    featuredServices(db, FEATURED_SERVICES),
  ]);
  const families = index.children.get(null) ?? [];

  return (
    <main className="mx-auto flex max-w-6xl flex-col gap-10 px-4 py-8">
      <section className="rounded-2xl bg-brand-navy px-6 py-10 text-white sm:px-10">
        <h1 className="text-3xl font-bold sm:text-4xl">{company.shopName}</h1>
        <p className="mt-3 max-w-2xl text-white/80">
          Équipements informatiques, réseaux, électronique, électricité et sécurité, ainsi que des services de
          maintenance, d&apos;installation réseau, de vidéosurveillance et d&apos;électricité.
        </p>
        <div className="mt-6 flex flex-wrap gap-3">
          <Link href="/recherche" className="rounded-lg bg-brand-accent px-4 py-2.5 font-semibold text-brand-navy">
            Voir les produits
          </Link>
          <Link href="/services" className="rounded-lg border border-white/40 px-4 py-2.5 font-semibold">
            Demander un service
          </Link>
        </div>
        <p className="mt-6 inline-flex items-center gap-2 rounded-lg bg-white/10 px-3 py-2 text-sm">
          <Banknote aria-hidden className="size-4 text-brand-accent" />
          Paiement exclusivement en espèces, à la livraison ou au retrait.
        </p>
      </section>

      <section aria-labelledby="univers">
        <h2 id="univers" className="text-xl font-semibold">
          Nos univers
        </h2>
        <ul className="mt-4 grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-6">
          {families.map((family) => {
            const Icon = FAMILY_ICONS[family.slug] ?? Package;
            return (
              <li key={family.id}>
                <Link
                  href={`/categories/${family.slug}`}
                  className="flex h-full flex-col items-start gap-3 rounded-xl border border-line bg-surface p-4 hover:border-brand-blue"
                >
                  <Icon aria-hidden className="size-6 text-brand-blue" />
                  <span className="text-sm font-medium">{family.name}</span>
                </Link>
              </li>
            );
          })}
        </ul>
      </section>

      {products.length > 0 && (
        <section aria-labelledby="selection">
          <div className="flex items-baseline justify-between gap-2">
            <h2 id="selection" className="text-xl font-semibold">
              Notre sélection
            </h2>
            <Link href="/recherche" className="text-sm text-brand-blue underline">
              Tout voir
            </Link>
          </div>
          <div className="mt-4">
            <ProductGrid products={products} />
          </div>
        </section>
      )}

      {services.length > 0 && (
        <section aria-labelledby="services">
          <div className="flex items-baseline justify-between gap-2">
            <h2 id="services" className="text-xl font-semibold">
              Services techniques
            </h2>
            <Link href="/services" className="text-sm text-brand-blue underline">
              Tous les services
            </Link>
          </div>
          <ul className="mt-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
            {services.map((service) => (
              <li key={service.slug}>
                <Link
                  href={`/services/${service.slug}`}
                  className="flex h-full flex-col gap-2 rounded-xl border border-line bg-surface p-4 hover:border-brand-blue"
                >
                  <Wrench aria-hidden className="size-5 text-brand-blue" />
                  <span className="font-medium">{service.name}</span>
                  <span className="text-sm text-ink-muted">{servicePriceLabel(service.pricingMode, service.price)}</span>
                </Link>
              </li>
            ))}
          </ul>
        </section>
      )}
      <JsonLd
        data={{
          "@context": "https://schema.org",
          "@type": "Store",
          name: company.shopName,
          url: absoluteUrl("/"),
          paymentAccepted: "Cash",
          currenciesAccepted: "XOF",
          ...(company.phone && { telephone: company.phone }),
          ...(company.address && { address: company.address }),
        }}
      />
    </main>
  );
}
