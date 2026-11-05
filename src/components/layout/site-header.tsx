import Link from "next/link";
import { signOutAction } from "@/app/(auth)/actions";
import { BrandIcon } from "@/components/brand/brand-icon";
import { HeaderLogo } from "@/components/brand/logo";
import { CatalogMenuView } from "@/components/layout/catalog-menu";
import { HeaderSearch } from "@/components/layout/header-search";
import { getCurrentUser } from "@/server/auth/session";
import { db } from "@/server/db/client";
import { countCartItems } from "@/server/modules/cart/service";
import { readCartOwner } from "@/server/modules/cart/session";
import { getCategoryIndex, getCompanySettings } from "@/server/storefront";

// Entre « lg » et « xl » (une seule ligne), l'espace est réduit, jamais le texte (14 px) : marges des liens à 8 px, libellés sur une ligne (sous « lg », le retour à la ligne reste permis).
const linkClass = "rounded-md px-3 py-2 text-sm font-medium text-ink/90 hover:bg-brand-navy/5 lg:whitespace-nowrap lg:px-2 xl:px-3";

/** Menu des familles de produits : données lues côté serveur, affichage et survol dans le composant client. */
async function CatalogMenu() {
  const index = await getCategoryIndex();
  // Seules des valeurs sérialisables traversent la frontière serveur/client.
  const families = (index.children.get(null) ?? []).map(({ id, slug, name }) => ({ id, slug, name }));
  return <CatalogMenuView families={families} linkClass={linkClass} />;
}

/** En-tête du site : marque, recherche, catalogue, services et accès au compte. */
export async function SiteHeader() {
  const [company, user, cartOwner] = await Promise.all([getCompanySettings(), getCurrentUser(), readCartOwner()]);
  const cartCount = cartOwner ? await countCartItems(db, cartOwner) : 0;
  return (
    // Collé en haut pendant le défilement ; le bandeau d'annonces, au-dessus, défile avec la page.
    <header className="sticky top-0 z-40 bg-brand-bar shadow-md">
      {/* Sous « lg » : marque et compte en haut, navigation et loupe dessous (flex, retour à la ligne, « order-* »).
          À partir de « lg » : une seule ligne en grille [1fr auto 1fr], la navigation principale est au centre exact
          du conteneur (colonnes latérales égales) ; si le groupe de droite est trop large, la colonne centrale se décale
          au lieu de chevaucher (un « 1fr » ne descend pas sous son contenu).
          « relative » : la recherche déployée se place par-dessus la ligne de la loupe. */}
      <div className="relative mx-auto flex max-w-6xl flex-wrap items-center gap-x-3 gap-y-2 px-4 py-3 lg:grid lg:grid-cols-[1fr_auto_1fr] lg:gap-x-2 xl:gap-x-3">
        <Link href="/" aria-label={`${company.shopName}, accueil`} className="order-1 shrink-0 lg:order-none lg:justify-self-start">
          <HeaderLogo shopName={company.shopName} logoUrl={company.logoUrl} />
        </Link>
        {/* Avant la loupe et le compte dans le DOM : à partir de « lg », l'ordre de tabulation suit l'ordre visuel. */}
        <nav aria-label="Navigation principale" className="order-4 flex items-center gap-1 lg:order-none">
          <CatalogMenu />
          <Link href="/services" className={linkClass}>
            Services
          </Link>
          <Link href="/contact" className={linkClass}>
            Contact
          </Link>
        </nav>
        {/* Saut de ligne forcé sous la marque et le compte, sauf sur grand écran. Ordres sous « lg » : marque 1, compte 2,
            saut 3, navigation 4, loupe 5 (tous distincts : l'ordre du DOM ne départage rien). */}
        <div aria-hidden className="order-3 basis-full lg:hidden" />
        {/* Colonne de droite à partir de « lg » (loupe puis compte) ; sous « lg », « contents » laisse ses enfants
            dans la ligne flex du conteneur, où leurs « order-* » s'appliquent. */}
        <div className="contents lg:flex lg:items-center lg:justify-end lg:gap-x-2 xl:gap-x-3">
          <div className="order-5 ml-auto lg:order-none lg:ml-0">
            <HeaderSearch />
          </div>
          <nav aria-label="Compte" className="order-2 ml-auto flex items-center gap-1 lg:order-none lg:ml-0">
            <Link href="/panier" className={`${linkClass} flex items-center gap-1`}>
              <BrandIcon name="panier" className="size-8" />
              {/* Libellé masqué (mais lu) entre « lg » et « xl » : l'icône reste, la place revient aux liens. */}
              <span className="sr-only sm:not-sr-only lg:sr-only xl:not-sr-only">Panier</span>
              {cartCount > 0 && (
                <span className="rounded-full bg-brand-accent px-1.5 text-xs font-bold text-brand-navy">{cartCount}</span>
              )}
            </Link>
            {user ? (
              <>
                {user.permissions.has("admin.access") && (
                  <Link href="/admin" className={linkClass}>
                    Administration
                  </Link>
                )}
                <Link href="/compte" className={linkClass}>
                  Mon compte
                </Link>
                <form action={signOutAction}>
                  <button type="submit" className={linkClass}>
                    Se déconnecter
                  </button>
                </form>
              </>
            ) : (
              <Link href="/connexion" className={`${linkClass} flex items-center gap-1`}>
                <BrandIcon name="mon-compte" className="size-8" />
                <span className="sr-only whitespace-nowrap sm:not-sr-only">Se connecter</span>
              </Link>
            )}
          </nav>
        </div>
      </div>
    </header>
  );
}
