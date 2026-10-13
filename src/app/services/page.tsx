import type { Metadata } from "next";
import Link from "next/link";
import { Breadcrumbs } from "@/components/layout/breadcrumbs";
import { servicePriceLabel } from "@/lib/labels";
import { db } from "@/server/db/client";
import { listServiceGroups } from "@/server/modules/services/queries";

export const metadata: Metadata = {
  title: "Services techniques",
  description:
    "Maintenance informatique, réseaux, vidéosurveillance et électricité : demandez un devis à l'équipe technique SYSTELEC.",
  alternates: { canonical: "/services" },
};

export default async function ServicesPage() {
  const groups = await listServiceGroups(db);
  return (
    <main className="mx-auto flex max-w-6xl flex-col gap-8 px-4 py-6">
      <Breadcrumbs items={[{ label: "Services", href: "/services" }]} />
      <header>
        <h1 className="text-2xl font-bold">Services techniques</h1>
        <p className="mt-2 max-w-2xl text-ink-muted">
          Des interventions réalisées par du personnel qualifié. Chaque prestation fait l&apos;objet d&apos;un devis
          adapté à votre besoin ; le règlement se fait en espèces après la prestation.
        </p>
      </header>
      {groups.map((group) => (
        <section key={group.slug} aria-labelledby={`famille-${group.slug}`} className="flex flex-col gap-3">
          <div>
            <h2 id={`famille-${group.slug}`} className="text-xl font-semibold">
              {group.name}
            </h2>
            {group.description && <p className="text-sm text-ink-muted">{group.description}</p>}
          </div>
          <ul className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
            {group.services.map((service) => (
              <li key={service.slug}>
                <Link
                  href={`/services/${service.slug}`}
                  className="flex h-full flex-col gap-1 rounded-xl border border-line bg-surface p-4 hover:border-brand-blue"
                >
                  <span className="font-medium">{service.name}</span>
                  <span className="text-sm text-brand-blue">{servicePriceLabel(service.pricingMode, service.price)}</span>
                </Link>
              </li>
            ))}
          </ul>
        </section>
      ))}
    </main>
  );
}
