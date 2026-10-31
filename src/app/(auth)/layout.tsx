import { Banknote, ClipboardList, PackageCheck, type LucideIcon } from "lucide-react";
import { Logo } from "@/components/brand/logo";
import { BRAND, SHOP_PILLARS_LINE } from "@/lib/brand";
import { getCompanySettings } from "@/server/storefront";

const BENEFITS: readonly { icon: LucideIcon; text: string }[] = [
  { icon: PackageCheck, text: "Suivez vos commandes, de la préparation à la remise." },
  { icon: ClipboardList, text: `Retrouvez vos demandes de devis et d'intervention ${BRAND.tech.name}.` },
  { icon: Banknote, text: "Paiement en espèces uniquement, à la livraison ou au retrait." },
];

/**
 * Mise en page commune des écrans d'authentification (mobile d'abord) : panneau de marque
 * (bandeau compact sur mobile, colonne à partir de lg) et carte du formulaire.
 */
export default async function AuthLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  const company = await getCompanySettings();
  return (
    <main className="mx-auto w-full max-w-5xl px-4 py-8 lg:py-12">
      <div className="overflow-hidden rounded-2xl border border-line bg-surface shadow-sm lg:grid lg:grid-cols-2">
        <aside className="flex flex-col gap-6 bg-brand-navy px-6 py-6 text-white sm:px-10 lg:py-10">
          <Logo shopName={company.shopName} logoUrl={company.logoUrl} />
          <div>
            <p className="text-lg font-medium">{BRAND.shop.tagline}</p>
            <p className="mt-1 text-sm font-semibold uppercase tracking-wide text-brand-accent">{SHOP_PILLARS_LINE}</p>
          </div>
          <ul className="hidden flex-col gap-4 lg:flex">
            {BENEFITS.map(({ icon: Icon, text }) => (
              <li key={text} className="flex items-start gap-3 text-sm text-white/85">
                <Icon aria-hidden className="mt-0.5 size-5 shrink-0 text-brand-accent" />
                {text}
              </li>
            ))}
          </ul>
          <p className="mt-auto hidden text-xs italic text-white/60 lg:block">
            {BRAND.group.name} — {BRAND.group.signature}
          </p>
        </aside>
        <div className="px-6 py-8 sm:px-10 lg:py-10">{children}</div>
      </div>
    </main>
  );
}
