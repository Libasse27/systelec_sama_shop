import Link from "next/link";
import { signOutAction } from "@/app/(auth)/actions";
import { Logo } from "@/components/brand/logo";
import { getCurrentUser } from "@/server/auth/session";
import { getSetting } from "@/server/modules/settings/service";

const linkClass = "rounded-md px-3 py-2 text-sm font-medium text-white/90 hover:bg-white/10";

/** En-tête du site : marque et accès au compte (rendu serveur, dépend de la session). */
export async function SiteHeader() {
  const [company, user] = await Promise.all([getSetting("company"), getCurrentUser()]);
  return (
    <header className="bg-brand-navy">
      <div className="mx-auto flex max-w-6xl items-center justify-between gap-2 px-4 py-3">
        <Link href="/" aria-label={`${company.shopName}, accueil`}>
          <Logo shopName={company.shopName} logoUrl={company.logoUrl} />
        </Link>
        <nav aria-label="Compte" className="flex items-center gap-1">
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
    </header>
  );
}
