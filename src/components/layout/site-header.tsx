import { ChevronDown, Search, ShoppingCart } from "lucide-react";
import Link from "next/link";
import { signOutAction } from "@/app/(auth)/actions";
import { Logo } from "@/components/brand/logo";
import { getCurrentUser } from "@/server/auth/session";
import { db } from "@/server/db/client";
import { countCartItems } from "@/server/modules/cart/service";
import { readCartOwner } from "@/server/modules/cart/session";
import { getCategoryIndex, getCompanySettings } from "@/server/storefront";

const linkClass = "rounded-md px-3 py-2 text-sm font-medium text-white/90 hover:bg-white/10";

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

function SearchForm() {
  return (
    <form action="/recherche" method="get" role="search" className="flex w-full items-center rounded-lg bg-white">
      <label htmlFor="recherche-site" className="sr-only">
        Rechercher un produit
      </label>
      <input
        id="recherche-site"
        type="search"
        name="q"
        placeholder="Produit, marque, référence…"
        className="min-w-0 flex-1 rounded-l-lg px-3 py-2 text-sm text-ink"
      />
      <button type="submit" className="rounded-r-lg bg-brand-accent px-3 py-2 text-brand-navy" aria-label="Lancer la recherche">
        <Search aria-hidden className="size-5" />
      </button>
    </form>
  );
}

/** En-tête du site : marque, recherche, catalogue, services et accès au compte. */
export async function SiteHeader() {
  const [company, user, cartOwner] = await Promise.all([getCompanySettings(), getCurrentUser(), readCartOwner()]);
  const cartCount = cartOwner ? await countCartItems(db, cartOwner) : 0;
  return (
    <header className="bg-brand-navy">
      <div className="mx-auto flex max-w-6xl flex-col gap-3 px-4 py-3">
        <div className="flex items-center justify-between gap-2">
          <Link href="/" aria-label={`${company.shopName}, accueil`}>
            <Logo shopName={company.shopName} logoUrl={company.logoUrl} />
          </Link>
          <nav aria-label="Compte" className="flex flex-wrap items-center justify-end gap-1">
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
              <Link href="/connexion" className={linkClass}>
                Se connecter
              </Link>
            )}
          </nav>
        </div>
        <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
          <nav aria-label="Navigation principale" className="flex items-center gap-1">
            <CatalogMenu />
            <Link href="/services" className={linkClass}>
              Services
            </Link>
            <Link href="/contact" className={linkClass}>
              Contact
            </Link>
          </nav>
          <div className="sm:ml-auto sm:w-96">
            <SearchForm />
          </div>
        </div>
      </div>
    </header>
  );
}
