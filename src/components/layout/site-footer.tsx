import { Banknote, Mail, MapPin, MessageSquare, Phone } from "lucide-react";
import Link from "next/link";
import type { ReactNode } from "react";
import { Logo } from "@/components/brand/logo";
import { getCompanySettings } from "@/server/storefront";
import { db } from "@/server/db/client";
import { listPublishedPages } from "@/server/modules/content/queries";

const linkClass = "text-sm text-white/80 hover:text-white hover:underline";
const contactLinkClass = "flex items-start gap-2 text-sm text-white/80 hover:text-white";

interface FooterSectionProps {
  title: string;
  children: ReactNode;
}

/** Colonne titrée ; le titre nomme aussi la navigation pour les lecteurs d'écran. */
function FooterSection({ title, children }: FooterSectionProps) {
  return (
    <nav aria-label={title} className="flex flex-col gap-2">
      <h2 className="mb-1 text-sm font-semibold uppercase tracking-wide text-white">{title}</h2>
      {children}
    </nav>
  );
}

/** Numéro composable : chiffres et « + » seulement (espaces et tirets de l'affichage retirés). */
function telHref(phone: string): string {
  return `tel:${phone.replace(/[^+\d]/g, "")}`;
}

/**
 * Pied de page : marque, boutique, aide (seules les pages publiées), coordonnées.
 * Sans coordonnées renseignées, la colonne « Contact » renvoie au formulaire de contact.
 */
export async function SiteFooter() {
  const [company, pages] = await Promise.all([getCompanySettings(), listPublishedPages(db)]);
  const hasContactDetails = Boolean(company.phone || company.email || company.address);
  return (
    <footer className="mt-12 bg-brand-navy text-white">
      <div className="mx-auto grid max-w-6xl gap-8 px-4 py-10 sm:grid-cols-2 lg:grid-cols-4">
        <div className="flex flex-col gap-3">
          <Link href="/" aria-label={`${company.shopName}, accueil`} className="self-start">
            <Logo shopName={company.shopName} logoUrl={company.logoUrl} />
          </Link>
          <p className="text-sm text-white/80">Équipements électroniques et services techniques.</p>
          <p className="flex items-center gap-2 text-sm">
            <Banknote aria-hidden className="size-4 shrink-0 text-brand-accent" />
            Paiement en espèces uniquement.
          </p>
        </div>
        <FooterSection title="Boutique">
          <Link href="/recherche" className={linkClass}>
            Tous les produits
          </Link>
          <Link href="/services" className={linkClass}>
            Services techniques
          </Link>
          <Link href="/compte" className={linkClass}>
            Mon compte
          </Link>
        </FooterSection>
        <FooterSection title="Aide">
          <Link href="/faq" className={linkClass}>
            Questions fréquentes
          </Link>
          <Link href="/contact" className={linkClass}>
            Contact
          </Link>
          {pages.map((page) => (
            <Link key={page.slug} href={`/pages/${page.slug}`} className={linkClass}>
              {page.title}
            </Link>
          ))}
        </FooterSection>
        <FooterSection title="Contact">
          {company.phone && (
            <a href={telHref(company.phone)} className={contactLinkClass}>
              <Phone aria-hidden className="mt-0.5 size-4 shrink-0 text-brand-accent" />
              {company.phone}
            </a>
          )}
          {company.email && (
            <a href={`mailto:${company.email}`} className={`${contactLinkClass} break-all`}>
              <Mail aria-hidden className="mt-0.5 size-4 shrink-0 text-brand-accent" />
              {company.email}
            </a>
          )}
          {company.address && (
            <p className="flex items-start gap-2 text-sm text-white/80">
              <MapPin aria-hidden className="mt-0.5 size-4 shrink-0 text-brand-accent" />
              <span className="whitespace-pre-line">{company.address}</span>
            </p>
          )}
          {!hasContactDetails && (
            <Link href="/contact" className={contactLinkClass}>
              <MessageSquare aria-hidden className="mt-0.5 size-4 shrink-0 text-brand-accent" />
              Écrivez-nous depuis la page Contact
            </Link>
          )}
        </FooterSection>
      </div>
      <div className="border-t border-white/10">
        <p className="mx-auto max-w-6xl px-4 py-4 text-center text-xs text-white/60 sm:text-left">
          © {new Date().getFullYear()} {company.companyName}. Tous droits réservés.
        </p>
      </div>
    </footer>
  );
}
