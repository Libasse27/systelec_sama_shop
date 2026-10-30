import { ChevronDown, ShoppingCart, UserRound } from "lucide-react";
import Link from "next/link";
import { signOutAction } from "@/app/(auth)/actions";
import { Logo } from "@/components/brand/logo";
import { HeaderSearch } from "@/components/layout/header-search";
import { getCurrentUser } from "@/server/auth/session";
import { db } from "@/server/db/client";
import { countCartItems } from "@/server/modules/cart/service";
import { readCartOwner } from "@/server/modules/cart/session";
import { getCategoryIndex, getCompanySettings } from "@/server/storefront";

const linkClass = "rounded-md px-3 py-2 text-sm font-medium text-white/90 hover:bg-white/10";
const iconLinkClass = "grid size-9 place-items-center rounded-md text-white/90 hover:bg-white/10";

/** Menu des familles de produits : élément <details> natif, utilisable sans JavaScript. */
async function CatalogMenu() {
  const index = await getCategoryIndex();
  const families = index.children.get(null) ?? [];
  return (
    <details className="group relative">
      <summary className={`${linkClass} flex cursor-pointer list-none items-center gap-1`}>
        Catalogue
        <ChevronDown aria-hidden className="size-4 transition group-open:rotate-180" />
      </summary>
      <ul className="absolute left-0 z-20 mt-1 w-72 max-w-[calc(100vw-2rem)] rounded-xl border border-line bg-surface p-2 text-ink shadow-lg">
        {families.map((family) => (
          <li key={family.id}>
            <Link href={`/categories/${family.slug}`} className="block rounded-lg px-3 py-2 text-sm hover:bg-surface-muted">
              {family.name}
            </Link>
          </li>
        ))}
        <li>
          <Link href="/recherche" className="block rounded-lg px-3 py-2 text-sm font-medium text-brand-blue hover:bg-surface-muted">
            Tous les produits
          </Link>
        </li>
      </ul>
    </details>
  );
}

/** En-tête du site : marque, recherche, catalogue, services et accès au compte. */
export async function SiteHeader() {
  const [company, user, cartOwner] = await Promise.all([getCompanySettings(), getCurrentUser(), readCartOwner()]);
  const cartCount = cartOwner ? await countCartItems(db, cartOwner) : 0;
  return (
    <header className="bg-brand-navy">
      {/* Une seule ligne sur grand écran ; en dessous, marque et compte en haut, navigation et loupe dessous.
          « relative » : la recherche déployée se place par-dessus la ligne de la loupe. */}
      <div className="relative mx-auto flex max-w-6xl flex-wrap items-center gap-x-3 gap-y-2 px-4 py-3">
        <Link href="/" aria-label={`${company.shopName}, accueil`} className="order-1 shrink-0">
          <Logo shopName={company.shopName} logoUrl={company.logoUrl} />
        </Link>
        <nav aria-label="Compte" className="order-2 ml-auto flex items-center gap-1 lg:order-4 lg:ml-0">
          <Link href="/panier" className={`${linkClass} flex items-center gap-1`}>
            <ShoppingCart aria-hidden className="size-4" />
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
            <Link href="/connexion" title="Se connecter" className={iconLinkClass}>
              <UserRound aria-hidden className="size-5" />
              <span className="sr-only">Se connecter</span>
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
