import { Clock, Mail, MapPin, MessageCircle, Phone, type LucideIcon } from "lucide-react";
import type { Metadata } from "next";
import { Breadcrumbs } from "@/components/layout/breadcrumbs";
import { BRAND } from "@/lib/brand";
import { telHref, whatsappHref } from "@/lib/contact-links";
import { db } from "@/server/db/client";
import { getServiceDetail } from "@/server/modules/services/queries";
import { getCompanySettings } from "@/server/storefront";

export const metadata: Metadata = {
  title: "Contact",
  description: `Contactez ${BRAND.shop.name} et ${BRAND.tech.name} : conseils, devis, interventions techniques et commandes.`,
  alternates: { canonical: "/contact" },
};

interface Props {
  searchParams: Promise<{ service?: string; objet?: string }>;
}

interface Channel {
  icon: LucideIcon;
  label: string;
  value: string;
  href?: string;
}

const SUBJECTS: Record<string, string> = { devis: "une demande de devis", intervention: "une réservation d'intervention" };

export default async function ContactPage({ searchParams }: Props) {
  const [{ service: serviceSlug, objet }, company] = await Promise.all([searchParams, getCompanySettings()]);
  const service = serviceSlug ? await getServiceDetail(db, serviceSlug) : null;
  const whatsapp = company.whatsapp ? whatsappHref(company.whatsapp) : null;
  const candidates: (Channel | null)[] = [
    company.phone ? { icon: Phone, label: "Téléphone", value: company.phone, href: telHref(company.phone) } : null,
    company.whatsapp && whatsapp ? { icon: MessageCircle, label: "WhatsApp", value: company.whatsapp, href: whatsapp } : null,
    company.email ? { icon: Mail, label: "E-mail", value: company.email, href: `mailto:${company.email}` } : null,
    company.address ? { icon: MapPin, label: "Adresse", value: company.address } : null,
    company.openingHours ? { icon: Clock, label: "Horaires", value: company.openingHours } : null,
  ];
  const channels = candidates.filter((channel): channel is Channel => channel !== null);

  return (
    <main className="mx-auto flex max-w-3xl flex-col gap-6 px-4 py-6">
      <Breadcrumbs items={[{ label: "Contact", href: "/contact" }]} />
      <h1 className="text-2xl font-bold">Contacter {company.shopName}</h1>
      {service && (
        <p role="status" className="rounded-xl border border-line bg-surface p-4">
          Votre demande concerne {objet && Object.hasOwn(SUBJECTS, objet) ? SUBJECTS[objet] : "la prestation"} : <strong>{service.name}</strong>. Précisez
          votre besoin, votre quartier et vos disponibilités lors de votre prise de contact.
        </p>
      )}
      {channels.length > 0 ? (
        <ul className="flex flex-col gap-3">
          {channels.map(({ icon: Icon, label, value, href }) => (
            <li key={label} className="flex items-start gap-3 rounded-xl border border-line bg-surface p-4">
              <Icon aria-hidden className="mt-0.5 size-5 text-brand-blue" />
              <div>
                <p className="text-sm text-ink-muted">{label}</p>
                {href ? (
                  <a href={href} className="font-medium text-brand-blue underline">
                    {value}
                  </a>
                ) : (
                  <p className="whitespace-pre-line font-medium">{value}</p>
                )}
              </div>
            </li>
          ))}
        </ul>
      ) : (
        <p className="text-ink-muted">Nos coordonnées seront publiées très prochainement.</p>
      )}
      <p className="text-sm text-ink-muted">Le formulaire de demande de devis en ligne arrive avec l&apos;espace services.</p>
    </main>
  );
}
