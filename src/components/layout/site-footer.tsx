import { Banknote, Clock, Mail, MapPin, MessageCircle, Phone } from "lucide-react";
import Link from "next/link";
import type { ReactNode } from "react";
import { Logo } from "@/components/brand/logo";
import { BRAND, SHOP_PILLARS_LINE } from "@/lib/brand";
import { telHref, whatsappHref } from "@/lib/contact-links";
import { getCompanySettings } from "@/server/storefront";
import { db } from "@/server/db/client";
import { listPublishedPages } from "@/server/modules/content/queries";

const linkClass = "text-sm text-white/80 hover:text-white hover:underline";
const contactLinkClass = "flex items-start gap-2 text-sm text-white/80 hover:text-white";
const contactTextClass = "flex items-start gap-2 text-sm text-white/80";
const contactIconClass = "mt-0.5 size-4 shrink-0 text-brand-accent";

interface FooterSectionProps {
  title: string;
  /** Colonne de liens (repère de navigation) ou simple bloc d'informations. */
  navigation?: boolean;
  children: ReactNode;
}

/** Colonne titrée ; pour une colonne de liens, le titre nomme aussi la navigation pour les lecteurs d'écran. */
function FooterSection({ title, navigation = true, children }: FooterSectionProps) {
  const Container = navigation ? "nav" : "div";
  return (
    <Container aria-label={navigation ? title : undefined} className="flex flex-col gap-2">
      <h2 className="mb-1 text-sm font-semibold uppercase tracking-wide text-white">{title}</h2>
      {children}
    </Container>
  );
}

/**
 * Pied de page : marque, boutique, aide (seules les pages publiées), coordonnées.
 * Les coordonnées sont celles de la page Contact (mêmes champs, mêmes liens) ; sans aucune
 * coordonnée renseignée, la colonne l'indique au lieu de promettre un formulaire.
 */
export async function SiteFooter() {
  const [company, pages] = await Promise.all([getCompanySettings(), listPublishedPages(db)]);
  const whatsapp = company.whatsapp ? whatsappHref(company.whatsapp) : null;
  const hasContactDetails = Boolean(company.phone || whatsapp || company.email || company.address || company.openingHours);
  return (
    <footer className="mt-12 bg-brand-navy text-white">
      <div className="mx-auto grid max-w-6xl gap-8 px-4 py-10 sm:grid-cols-2 lg:grid-cols-4">
        <div className="flex flex-col gap-3">
          <Link href="/" aria-label={`${company.shopName}, accueil`} className="self-start">
            <Logo shopName={company.shopName} logoUrl={company.logoUrl} />
          </Link>
          <p className="text-sm text-white/80">
            {BRAND.shop.tagline}
            <br />
            {SHOP_PILLARS_LINE}
          </p>
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
        <FooterSection title="Contact" navigation={false}>
          {company.phone && (
            <a href={telHref(company.phone)} className={contactLinkClass}>
              <Phone aria-hidden className={contactIconClass} />
              {company.phone}
            </a>
          )}
          {company.whatsapp && whatsapp && (
            <a href={whatsapp} className={contactLinkClass} target="_blank" rel="noopener noreferrer">
              <MessageCircle aria-hidden className={contactIconClass} />
              WhatsApp : {company.whatsapp}
            </a>
          )}
          {company.email && (
            <a href={`mailto:${company.email}`} className={`${contactLinkClass} break-all`}>
              <Mail aria-hidden className={contactIconClass} />
              {company.email}
            </a>
          )}
          {company.address && (
            <p className={contactTextClass}>
              <MapPin aria-hidden className={contactIconClass} />
              <span className="whitespace-pre-line">{company.address}</span>
            </p>
          )}
          {company.openingHours && (
            <p className={contactTextClass}>
              <Clock aria-hidden className={contactIconClass} />
              <span className="whitespace-pre-line">{company.openingHours}</span>
            </p>
          )}
          {!hasContactDetails && <p className="text-sm text-white/80">Nos coordonnées seront publiées très prochainement.</p>}
        </FooterSection>
      </div>
      <div className="border-t border-white/10">
        <div className="mx-auto flex max-w-6xl flex-col gap-1 px-4 py-4 text-center text-xs text-white/60 sm:flex-row sm:justify-between sm:text-left">
          <p>
            © {new Date().getFullYear()} {company.companyName}. Tous droits réservés.
          </p>
          <p className="italic">
            {BRAND.group.name} — {BRAND.group.signature}
          </p>
        </div>
      </div>
    </footer>
  );
}
