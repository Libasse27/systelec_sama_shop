import { PaymentMethodIcons } from "@/components/brand/payment-method-icons";
import { BrandIcon, type BrandIconName } from "@/components/brand/brand-icon";
import { BrandLogo, Logo } from "@/components/brand/logo";
import { BRAND, SHOP_PILLARS_LINE } from "@/lib/brand";
import { PAYMENT_NOTICE } from "@/lib/payment-methods";
import { getCompanySettings } from "@/server/storefront";

const BENEFITS: readonly { icon: BrandIconName; text: string }[] = [
  { icon: "livraison", text: "Suivez vos commandes, de la préparation à la remise." },
  { icon: "facture", text: `Retrouvez vos demandes de devis et d'intervention ${BRAND.tech.name}.` },
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
          <div className="self-start">
            <Logo shopName={company.shopName} logoUrl={company.logoUrl} priority />
          </div>
          <div>
            <p className="text-lg font-medium">{BRAND.shop.tagline}</p>
            <p className="mt-1 text-sm font-semibold uppercase tracking-wide text-brand-accent">{SHOP_PILLARS_LINE}</p>
          </div>
          <ul className="hidden flex-col gap-4 lg:flex">
            {BENEFITS.map(({ icon, text }) => (
              <li key={text} className="flex items-start gap-3 text-sm text-white/85">
                <BrandIcon name={icon} className="mt-0.5 size-6" />
                {text}
              </li>
            ))}
            <li className="flex flex-col gap-2 text-sm text-white/85">
              <PaymentMethodIcons />
              {PAYMENT_NOTICE}
            </li>
          </ul>
          <div className="mt-auto hidden flex-col items-start gap-2 lg:flex">
            <BrandLogo variant="group" className="h-9" />
            <p className="text-xs italic text-white/60">{BRAND.group.signature}</p>
          </div>
        </aside>
        <div className="px-6 py-8 sm:px-10 lg:py-10">{children}</div>
      </div>
    </main>
  );
}
