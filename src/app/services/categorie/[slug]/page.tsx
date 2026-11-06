import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { cache } from "react";
import { Breadcrumbs } from "@/components/layout/breadcrumbs";
import { ServiceCallToAction } from "@/components/services/service-call-to-action";
import { BRAND } from "@/lib/brand";
import { servicePriceLabel } from "@/lib/labels";
import { serviceFamilyPath, serviceQuotePath } from "@/lib/service-paths";
import { db } from "@/server/db/client";
import { getServiceGroup } from "@/server/modules/services/queries";

interface Props {
  params: Promise<{ slug: string }>;
}

const loadGroup = cache((slug: string) => getServiceGroup(db, slug));

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const group = await loadGroup((await params).slug);
  if (!group) return {};
  return {
    title: { absolute: `${group.name} | ${BRAND.tech.name}` },
    description: group.description ?? `${group.name} : demandez un devis à ${BRAND.tech.name}.`,
    alternates: { canonical: serviceFamilyPath(group.slug) },
  };
}

/** Page d'une famille : ses prestations, chacune avec sa fiche et un accès direct au devis prérempli. */
export default async function ServiceFamilyPage({ params }: Props) {
  const group = await loadGroup((await params).slug);
  if (!group) notFound();

  return (
    <main className="mx-auto flex max-w-6xl flex-col gap-8 px-4 py-6">
      <Breadcrumbs
        items={[
          { label: "Services", href: "/services" },
          { label: group.name, href: serviceFamilyPath(group.slug) },
        ]}
      />
      <header className="flex flex-col gap-2">
        <p className="text-sm font-medium text-brand-blue">{BRAND.tech.name}</p>
        <h1 className="text-2xl font-bold">{group.name}</h1>
        {group.description && <p className="max-w-2xl text-ink-muted">{group.description}</p>}
      </header>
      <ul className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
        {group.services.map((service) => (
          <li key={service.slug} className="flex h-full flex-col gap-2 rounded-xl border border-line bg-surface p-4">
            <Link href={`/services/${service.slug}`} className="flex flex-col gap-1 hover:underline">
              <span className="font-medium">{service.name}</span>
              <span className="text-sm text-brand-blue">{servicePriceLabel(service.pricingMode, service.price)}</span>
            </Link>
            <Link
              href={serviceQuotePath(service.slug)}
              className="mt-auto inline-flex min-h-11 items-center text-sm font-semibold text-brand-blue hover:underline"
            >
              Demander un devis<span className="sr-only"> : {service.name}</span>
            </Link>
          </li>
        ))}
      </ul>
      <ServiceCallToAction />
    </main>
  );
}
