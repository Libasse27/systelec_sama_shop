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

const linkClass = "rounded-md px-3 py-2 text-sm font-medium text-ink/90 hover:bg-brand-navy/5";

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
      {/* Une seule ligne sur grand écran ; en dessous, marque et compte en haut, navigation et loupe dessous.
          « relative » : la recherche déployée se place par-dessus la ligne de la loupe. */}
      <div className="relative mx-auto flex max-w-6xl flex-wrap items-center gap-x-3 gap-y-2 px-4 py-3">
        <Link href="/" aria-label={`${company.shopName}, accueil`} className="order-1 shrink-0">
          <HeaderLogo shopName={company.shopName} logoUrl={company.logoUrl} />
        </Link>
        <nav aria-label="Compte" className="order-2 ml-auto flex items-center gap-1 lg:order-4 lg:ml-0">
          <Link href="/panier" className={`${linkClass} flex items-center gap-1`}>
            <BrandIcon name="panier" className="size-8" />
            <span className="sr-only sm:not-sr-only">Panier</span>
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
        {/* Saut de ligne forcé sous la marque et le compte, sauf sur grand écran. */}
        <div aria-hidden className="order-2 basis-full lg:hidden" />
        <nav aria-label="Navigation principale" className="order-3 flex items-center gap-1 lg:order-2">
          <CatalogMenu />
          <Link href="/services" className={linkClass}>
            Services
          </Link>
          <Link href="/contact" className={linkClass}>
            Contact
          </Link>
        </nav>
        <div className="order-4 ml-auto lg:order-3">
          <HeaderSearch />
        </div>
      </div>
    </header>
  );
}
