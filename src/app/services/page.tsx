import type { Metadata } from "next";
import Link from "next/link";
import { BrandLogo } from "@/components/brand/logo";
import { Breadcrumbs } from "@/components/layout/breadcrumbs";
import { primaryActionClass, secondaryActionClass } from "@/components/services/service-action-styles";
import { ServiceCallToAction } from "@/components/services/service-call-to-action";
import { ServiceFamilyCard } from "@/components/services/service-family-card";
import { BRAND } from "@/lib/brand";
import { ACCEPTED_PAYMENT_METHODS } from "@/lib/payment-methods";
import { db } from "@/server/db/client";
import { listServiceGroups } from "@/server/modules/services/queries";

export const metadata: Metadata = {
  title: { absolute: `Services techniques | ${BRAND.tech.name}` },
  description: `Maintenance informatique, réseaux, vidéosurveillance, électricité et développement web : demandez un devis à ${BRAND.tech.name}, ${BRAND.tech.description}.`,
  alternates: { canonical: "/services" },
};

export default async function ServicesPage() {
  const groups = await listServiceGroups(db);
  return (
    <main className="mx-auto flex max-w-6xl flex-col gap-8 px-4 py-6">
      <Breadcrumbs items={[{ label: "Services", href: "/services" }]} />
      <header className="flex flex-col gap-4 sm:flex-row sm:items-center sm:gap-6">
        <BrandLogo variant="tech" className="h-20" priority />
        <div>
          <h1 className="text-2xl font-bold">{BRAND.tech.name} — Nos solutions informatiques et techniques</h1>
          <p className="mt-2 max-w-2xl text-ink-muted">
            Des interventions réalisées par du personnel qualifié. Chaque prestation fait l&apos;objet d&apos;un devis
            adapté à votre besoin ; le règlement se fait {ACCEPTED_PAYMENT_METHODS}, après la prestation.
          </p>
          <div className="mt-4 flex flex-col gap-3 sm:flex-row">
            <Link href="/devis/demande" className={primaryActionClass}>
              Demander un devis
            </Link>
            <a href="#familles" className={secondaryActionClass}>
              Découvrir nos services
            </a>
          </div>
        </div>
      </header>
      <section id="familles" aria-label="Familles de services">
        <ul className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {groups.map((group) => (
            <li key={group.slug}>
              <ServiceFamilyCard slug={group.slug} name={group.name} description={group.description} />
            </li>
          ))}
        </ul>
      </section>
      <ServiceCallToAction />
    </main>
  );
}
