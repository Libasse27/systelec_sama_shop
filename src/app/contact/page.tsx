import { CheckCircle2, Clock, Mail, MapPin, MessageCircle, Phone, type LucideIcon } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";
import { randomUUID } from "node:crypto";
import { ActionForm, SelectField, SubmitButton, TextAreaField, TextField } from "@/components/forms/form-controls";
import { Breadcrumbs } from "@/components/layout/breadcrumbs";
import { BRAND } from "@/lib/brand";
import { telHref, whatsappHref } from "@/lib/contact-links";
import { CONTACT_SUBJECT_LABELS } from "@/lib/labels";
import { getCurrentUser } from "@/server/auth/session";
import { db } from "@/server/db/client";
import { getServiceDetail } from "@/server/modules/services/queries";
import { getCompanySettings } from "@/server/storefront";
import { submitContactMessageAction } from "./actions";

// Chaque affichage porte sa propre clé d'envoi : une page mise en cache la partagerait entre visiteurs.
export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "Contact",
  description: `Contactez ${BRAND.shop.name} et ${BRAND.tech.name} : conseils, devis, interventions techniques et commandes.`,
  alternates: { canonical: "/contact" },
};

interface Props {
  searchParams: Promise<{ service?: string; objet?: string; envoye?: string }>;
}

interface Channel {
  icon: LucideIcon;
  label: string;
  value: string;
  href?: string;
}

const SUBJECTS: Record<string, string> = { devis: "une demande de devis", intervention: "une réservation d'intervention" };
const SUBJECT_OPTIONS = Object.entries(CONTACT_SUBJECT_LABELS).map(([value, label]) => ({ value, label }));
/** Numéro renvoyé après l'envoi : seul un numéro bien formé est affiché. */
const MESSAGE_NUMBER = /^MSG-\d{4}-\d{6}$/;

export default async function ContactPage({ searchParams }: Props) {
  const [{ service: serviceSlug, objet, envoye }, company, user] = await Promise.all([searchParams, getCompanySettings(), getCurrentUser()]);
  const service = serviceSlug ? await getServiceDetail(db, serviceSlug) : null;
  const sentNumber = envoye && MESSAGE_NUMBER.test(envoye) ? envoye : null;
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
      <section aria-labelledby="formulaire-contact" className="rounded-xl border border-line bg-surface p-4 sm:p-6">
        <h2 id="formulaire-contact" className="text-lg font-semibold">
          Écrivez-nous
        </h2>
        {sentNumber ? (
          <div id="confirmation" role="status" className="mt-4 flex items-start gap-3 rounded-lg border border-green-200 bg-green-50 p-4 text-green-900">
            <CheckCircle2 aria-hidden className="mt-0.5 size-5 shrink-0" />
            <div>
              <p className="font-semibold">Message envoyé, merci !</p>
              <p className="text-sm">
                Il est enregistré sous le numéro <strong>{sentNumber}</strong>. Nous vous répondons dans les meilleurs délais.
              </p>
              <Link href="/contact" className="mt-2 inline-block text-sm font-medium underline">
                Envoyer un autre message
              </Link>
            </div>
          </div>
        ) : (
          <ContactForm
            defaultName={user?.name}
            defaultEmail={user?.email}
            defaultSubject={service || objet === "devis" || objet === "intervention" ? "QUOTE" : undefined}
            defaultMessage={service ? `Concernant le service : ${service.name}\n\n` : undefined}
          />
        )}
      </section>
      <p className="text-sm text-ink-muted">
        Pour un devis détaillé ou une intervention technique, utilisez plutôt notre{" "}
        <Link href="/devis/demande" className="font-medium text-brand-blue underline">
          formulaire de demande de devis
        </Link>
        .
      </p>
    </main>
  );
}

interface ContactFormProps {
  defaultName?: string;
  defaultEmail?: string;
  defaultSubject?: string;
  defaultMessage?: string;
}

function ContactForm({ defaultName, defaultEmail, defaultSubject, defaultMessage }: ContactFormProps) {
  return (
    <ActionForm action={submitContactMessageAction} className="mt-4">
      <input type="hidden" name="idempotencyKey" value={randomUUID()} />
      {/* Champ piège : invisible pour les visiteurs, rempli par les robots (message alors refusé). */}
      <div aria-hidden className="absolute -left-[10000px] size-px overflow-hidden">
        <label htmlFor="contact-website">Ne pas remplir</label>
        <input id="contact-website" name="website" type="text" tabIndex={-1} autoComplete="off" />
      </div>
      <div className="grid gap-4 sm:grid-cols-2">
        <TextField name="name" label="Nom complet" defaultValue={defaultName} className="sm:col-span-2" />
        <TextField name="email" label="E-mail" type="email" required={false} defaultValue={defaultEmail} hint="E-mail ou téléphone : au moins l'un des deux." />
        <TextField name="phone" label="Téléphone" type="tel" required={false} />
        <SelectField name="subject" label="Sujet" options={SUBJECT_OPTIONS} defaultValue={defaultSubject ?? "GENERAL"} />
        <TextField name="reference" label="Numéro de commande ou de demande" required={false} hint="Par exemple : CMD-2026-000123." />
      </div>
      <TextAreaField name="message" label="Votre message" rows={6} defaultValue={defaultMessage} />
      <p className="text-xs text-ink-muted">Vos coordonnées servent uniquement à vous répondre.</p>
      <div>
        <SubmitButton>Envoyer le message</SubmitButton>
      </div>
    </ActionForm>
  );
}
