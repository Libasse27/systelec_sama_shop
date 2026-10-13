import { Clock, Mail, MapPin, MessageCircle, Phone, type LucideIcon } from "lucide-react";
import type { Metadata } from "next";
import { Breadcrumbs } from "@/components/layout/breadcrumbs";
import { db } from "@/server/db/client";
import { getServiceDetail } from "@/server/modules/services/queries";
import { getSetting } from "@/server/modules/settings/service";

export const metadata: Metadata = {
  title: "Contact",
  description: "Contactez SYSTELEC : conseils, devis, interventions techniques et commandes.",
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
const digitsOnly = (value: string) => value.replace(/\D/g, "");

export default async function ContactPage({ searchParams }: Props) {
  const [{ service: serviceSlug, objet }, company] = await Promise.all([searchParams, getSetting("company")]);
  const service = serviceSlug ? await getServiceDetail(db, serviceSlug) : null;
  const candidates: (Channel | null)[] = [
    company.phone ? { icon: Phone, label: "Téléphone", value: company.phone, href: `tel:${company.phone.replace(/\s/g, "")}` } : null,
    company.whatsapp
      ? { icon: MessageCircle, label: "WhatsApp", value: company.whatsapp, href: `https://wa.me/${digitsOnly(company.whatsapp)}` }
      : null,
    company.email ? { icon: Mail, label: "E-mail", value: company.email, href: `mailto:${company.email}` } : null,
    company.address ? { icon: MapPin, label: "Adresse", value: company.address } : null,
    company.openingHours ? { icon: Clock, label: "Horaires", value: company.openingHours } : null,
  ];
  const channels = candidates.filter((channel): channel is Channel => channel !== null);

  return (
    <main className="mx-auto flex max-w-3xl flex-col gap-6 px-4 py-6">
      <Breadcrumbs items={[{ label: "Contact", href: "/contact" }]} />
      <h1 className="text-2xl font-bold">Contacter {company.companyName}</h1>
      {service && (
        <p role="status" className="rounded-xl border border-line bg-surface p-4">
          Votre demande concerne {SUBJECTS[objet ?? ""] ?? "la prestation"} : <strong>{service.name}</strong>. Précisez
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
