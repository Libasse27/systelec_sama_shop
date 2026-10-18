import { Banknote } from "lucide-react";
import Link from "next/link";
import { getCompanySettings } from "@/server/storefront";
import { db } from "@/server/db/client";
import { listPublishedPages } from "@/server/modules/content/queries";

const linkClass = "text-sm text-white/80 hover:text-white hover:underline";

/** Pied de page : liens utiles (seules les pages publiées), coordonnées, rappel du paiement en espèces. */
export async function SiteFooter() {
  const [company, pages] = await Promise.all([getCompanySettings(), listPublishedPages(db)]);
  return (
    <footer className="mt-12 bg-brand-navy text-white">
      <div className="mx-auto grid max-w-6xl gap-8 px-4 py-10 sm:grid-cols-3">
        <div className="flex flex-col gap-2">
          <p className="font-semibold">{company.shopName}</p>
          <p className="text-sm text-white/80">Équipements électroniques et services techniques.</p>
          <p className="flex items-center gap-2 text-sm">
            <Banknote aria-hidden className="size-4 text-brand-accent" />
            Paiement en espèces uniquement.
          </p>
        </div>
        <nav aria-label="Liens utiles" className="flex flex-col gap-2">
          <Link href="/services" className={linkClass}>
            Services techniques
          </Link>
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
        </nav>
        <div className="flex flex-col gap-1 text-sm text-white/80">
          {company.phone && <p>Tél. : {company.phone}</p>}
          {company.email && <p>{company.email}</p>}
          {company.address && <p className="whitespace-pre-line">{company.address}</p>}
        </div>
      </div>
      <p className="border-t border-white/10 py-4 text-center text-xs text-white/60">
        © {new Date().getFullYear()} {company.companyName}
      </p>
    </footer>
  );
}
