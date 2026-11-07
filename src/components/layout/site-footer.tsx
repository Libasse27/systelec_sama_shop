import { Clock } from "lucide-react";
import Link from "next/link";
import type { ReactNode } from "react";
import { BrandIcon } from "@/components/brand/brand-icon";
import { BrandLogo, Logo } from "@/components/brand/logo";
import { FOOTER_ICON_TILE, SocialLinks } from "@/components/layout/social-links";
import { BRAND, SHOP_PILLARS_LINE } from "@/lib/brand";
import { mailtoHref, telHref, whatsappHref } from "@/lib/contact-links";
import { PAYMENT_METHOD_ICONS, PAYMENT_METHOD_OPTIONS } from "@/lib/payment-methods";
import { socialButtons } from "@/lib/social-links";
import { cn } from "@/lib/utils";
import { db } from "@/server/db/client";
import { listPublishedPages } from "@/server/modules/content/queries";
import type { SettingValue } from "@/server/modules/settings/schemas";
import { getCompanySettings } from "@/server/storefront";

type CompanySettings = SettingValue<"company">;

const linkClass = "text-sm text-ink-muted hover:text-ink hover:underline";
const contactLinkClass = "flex items-start gap-2 text-sm text-ink-muted hover:text-ink";
const contactTextClass = "flex items-start gap-2 text-sm text-ink-muted";
const contactIconClass = "mt-0.5 size-4 shrink-0 text-brand-accent";
const contactPictoClass = "mt-0.5 size-5";

interface FooterSectionProps {
  title: string;
  /** Colonne de liens (repère de navigation) ou simple bloc d'informations. */
  navigation?: boolean;
  /** Classes ajoutées à la colonne (ex. étendue sur la grille). */
  className?: string;
  children: ReactNode;
}

/** Colonne titrée ; pour une colonne de liens, le titre nomme aussi la navigation pour les lecteurs d'écran. */
function FooterSection({ title, navigation = true, className, children }: FooterSectionProps) {
  const Container = navigation ? "nav" : "div";
  return (
    <Container aria-label={navigation ? title : undefined} className={cn("flex flex-col gap-2", className)}>
      <h2 className="mb-1 text-sm font-semibold uppercase tracking-wide text-ink">{title}</h2>
      {children}
    </Container>
  );
}

/** Mêmes champs et mêmes validations que la page Contact ; une valeur inutilisable n'est pas affichée ici. Sans aucune coordonnée, la colonne l'indique au lieu de promettre un formulaire. */
function FooterContact({ company }: { company: CompanySettings }) {
  const whatsapp = company.whatsapp ? whatsappHref(company.whatsapp) : null;
  const tel = company.phone ? telHref(company.phone) : null;
  const mailto = company.email ? mailtoHref(company.email) : null;
  const hasContactDetails = Boolean(tel || whatsapp || mailto || company.address || company.openingHours);
  return (
    <FooterSection title="Contact" navigation={false}>
      {company.phone && tel && (
        <a href={tel} className={contactLinkClass}>
          <BrandIcon name="telephone" className={contactPictoClass} />
          {company.phone}
        </a>
      )}
      {company.whatsapp && whatsapp && (
        <a href={whatsapp} className={contactLinkClass} target="_blank" rel="noopener noreferrer">
          <BrandIcon name="whatsapp" className={contactPictoClass} />
          WhatsApp : {company.whatsapp}
        </a>
      )}
      {company.email && mailto && (
        <a href={mailto} className={contactLinkClass}>
          <BrandIcon name="email" className={contactPictoClass} />
          {company.email}
        </a>
      )}
      {company.address && (
        <p className={contactTextClass}>
          <BrandIcon name="localisation" className={contactPictoClass} />
          <span className="whitespace-pre-line">{company.address}</span>
        </p>
      )}
      {company.openingHours && (
        <p className={contactTextClass}>
          <Clock aria-hidden className={contactIconClass} />
          <span className="whitespace-pre-line">{company.openingHours}</span>
        </p>
      )}
      {!hasContactDetails && <p className="text-sm text-ink-muted">Nos coordonnées seront publiées très prochainement.</p>}
    </FooterSection>
  );
}

/** Moyens de paiement acceptés, un par ligne ; les pictogrammes de largeurs différentes gardent les libellés alignés. */
function FooterPayment() {
  return (
    <FooterSection title="Paiement" navigation={false}>
      <ul className="flex flex-col gap-2">
        {PAYMENT_METHOD_OPTIONS.map(({ value, label }) => (
          <li key={value} className="flex items-center gap-2 text-sm text-ink-muted">
            {/* Même cadre teinté que les réseaux sociaux, sans survol : les moyens de paiement ne sont pas cliquables.
                Boîte h-9 w-10 : object-contain garde les proportions (une icône 2 fois plus large remplit les 40 px). */}
            <span className={FOOTER_ICON_TILE}>
              <BrandIcon name={PAYMENT_METHOD_ICONS[value].name} className="h-9 w-10" />
            </span>
            {label}
          </li>
        ))}
      </ul>
      <p className="text-sm text-ink-muted">À la livraison ou au retrait.</p>
    </FooterSection>
  );
}

/**
 * Réseaux sociaux : section dédiée, toujours rendue avec les six icônes. Une icône dont l'adresse est valide
 * est un lien ; les autres restent visibles sans lien. La section n'est un repère de navigation nommé
 * que s'il existe au moins un lien (pas de repère vide pour les lecteurs d'écran).
 */
function FooterSocial({ company }: { company: CompanySettings }) {
  const buttons = socialButtons(company.socialLinks);
  const hasLink = buttons.some((button) => button.href !== null);
  return (
    <FooterSection title="Réseaux sociaux" navigation={hasLink} className="sm:col-span-2 lg:col-span-1">
      <SocialLinks buttons={buttons} />
    </FooterSection>
  );
}

/** Copyright au nom du groupe, mentions légales de la société (saisies dans l'administration), signature du groupe. */
function FooterBottomBar({ company }: { company: CompanySettings }) {
  const legalMentions = [`Raison sociale : ${company.companyName}`, company.ninea && `NINEA : ${company.ninea}`, company.rccm && `RCCM : ${company.rccm}`].filter(Boolean).join(" · ");
  return (
    <div className="border-t border-ink/10">
      <div className="mx-auto flex max-w-6xl flex-col gap-3 px-4 py-4 text-center text-xs text-ink-muted sm:flex-row sm:items-center sm:justify-between sm:gap-6 sm:text-left">
        <div className="flex flex-col gap-1">
          <p>
            © {new Date().getFullYear()} {BRAND.group.name}. Tous droits réservés.
          </p>
          <p>{legalMentions}</p>
        </div>
        <p className="flex items-center justify-center gap-3 italic sm:shrink-0 sm:justify-start">
          <BrandLogo variant="group" className="h-8" />
          {BRAND.group.signature}
        </p>
      </div>
    </div>
  );
}

/**
 * Pied de page : marque (logo, slogan), boutique, aide (seules les pages publiées), puis coordonnées,
 * paiement et réseaux sociaux (section dédiée, seulement les liens enregistrés et conformes,
 * src/lib/social-links.ts). Trois colonnes sur deux rangées sur ordinateur, deux colonnes sur tablette
 * (la marque et les réseaux sociaux occupant toute la largeur), une seule sur mobile ; puis une barre
 * finale : copyright, mentions légales, signature du groupe.
 * Les valeurs saisies dans l'administration sont du texte brut et peuvent couper n'importe où (wrap-anywhere).
 */
export async function SiteFooter() {
  const [company, pages] = await Promise.all([getCompanySettings(), listPublishedPages(db)]);
  return (
    <footer className="mt-12 border-t border-ink/10 bg-brand-bar text-ink wrap-anywhere">
      <div className="mx-auto grid max-w-6xl grid-cols-1 gap-8 px-4 py-10 sm:grid-cols-2 lg:grid-cols-3">
        <div className="flex flex-col gap-3 sm:col-span-2 lg:col-span-1">
          <Link href="/" aria-label={`${company.shopName}, accueil`} className="self-start">
            <Logo shopName={company.shopName} logoUrl={company.logoUrl} />
          </Link>
          <p className="text-sm text-ink-muted">
            {BRAND.shop.tagline}
            <br />
            {SHOP_PILLARS_LINE}
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
        <FooterContact company={company} />
        <FooterPayment />
        <FooterSocial company={company} />
      </div>
      <FooterBottomBar company={company} />
    </footer>
  );
}
