import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { cache } from "react";
import { PaymentMethodIcons } from "@/components/brand/payment-method-icons";
import { Breadcrumbs } from "@/components/layout/breadcrumbs";
import { JsonLd } from "@/components/seo/json-ld";
import { primaryActionClass, secondaryActionClass } from "@/components/services/service-action-styles";
import { BRAND } from "@/lib/brand";
import { servicePriceLabel } from "@/lib/labels";
import { ACCEPTED_PAYMENT_METHODS } from "@/lib/payment-methods";
import { serviceFamilyPath, serviceQuotePath } from "@/lib/service-paths";
import { db } from "@/server/db/client";
import { toParagraphs } from "@/server/modules/content/queries";
import { getServiceDetail } from "@/server/modules/services/queries";
import { absoluteUrl } from "@/server/storefront";

interface Props {
  params: Promise<{ slug: string }>;
}

const loadService = cache((slug: string) => getServiceDetail(db, slug));

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const service = await loadService((await params).slug);
  if (!service) return {};
  return {
    title: service.name,
    description: service.shortDescription,
    alternates: { canonical: `/services/${service.slug}` },
  };
}

export default async function ServicePage({ params }: Props) {
  const service = await loadService((await params).slug);
  if (!service) notFound();

  return (
    <main className="mx-auto flex max-w-4xl flex-col gap-6 px-4 py-6">
      <Breadcrumbs
        items={[
          { label: "Services", href: "/services" },
          { label: service.name, href: `/services/${service.slug}` },
        ]}
      />
      <header className="flex flex-col gap-2">
        <Link href={serviceFamilyPath(service.category.slug)} className="inline-flex min-h-11 w-fit items-center text-sm font-medium text-brand-blue hover:underline">
          {service.category.name}
        </Link>
        <h1 className="text-2xl font-bold">{service.name}</h1>
        <p className="text-lg font-semibold text-brand-navy">{servicePriceLabel(service.pricingMode, service.price)}</p>
      </header>

      <div className="flex flex-col gap-3 sm:flex-row">
        <Link href={serviceQuotePath(service.slug)} className={primaryActionClass}>
          Demander un devis ou une intervention
        </Link>
        <Link href="/contact" className={secondaryActionClass}>
          Nous contacter
        </Link>
      </div>

      <section className="flex flex-col gap-3 rounded-xl border border-line bg-surface p-5">
        {toParagraphs(service.description).map((paragraph, i) => (
          <p key={`${i}-${paragraph.slice(0, 20)}`}>{paragraph}</p>
        ))}
        <dl className="grid gap-x-6 gap-y-2 text-sm sm:grid-cols-[12rem_1fr]">
          {service.estimatedDuration && (
            <>
              <dt className="text-ink-muted">Durée estimée</dt>
              <dd>{service.estimatedDuration}</dd>
            </>
          )}
          <dt className="text-ink-muted">Zone d&apos;intervention</dt>
          <dd>{service.zonesText ?? "Précisée lors de l'étude de votre demande."}</dd>
          {service.conditions && (
            <>
              <dt className="text-ink-muted">Conditions</dt>
              <dd>{service.conditions}</dd>
            </>
          )}
        </dl>
      </section>

      <p className="flex items-center gap-2 text-sm text-ink-muted">
        <PaymentMethodIcons />
        Règlement {ACCEPTED_PAYMENT_METHODS}, après la prestation.
      </p>
      <JsonLd
        data={{
          "@context": "https://schema.org",
          "@type": "Service",
          name: service.name,
          description: service.shortDescription,
          serviceType: service.category.name,
          provider: {
            "@type": "Organization",
            name: BRAND.tech.name,
            parentOrganization: { "@type": "Organization", name: BRAND.group.name },
          },
          url: absoluteUrl(`/services/${service.slug}`),
          ...(service.price !== null && {
            offers: { "@type": "Offer", priceCurrency: "XOF", price: service.price },
          }),
        }}
      />
    </main>
  );
}
