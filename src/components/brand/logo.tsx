import Image from "next/image";
import { BRAND } from "@/lib/brand";
import { cn } from "@/lib/utils";

/** Logos officiels (fond détouré), servis depuis public/logos ; dimensions intrinsèques des fichiers. */
const BRAND_LOGOS = {
  shop: { src: "/logos/futani-shop.png", width: 354, height: 146, alt: BRAND.shop.name },
  group: { src: "/logos/futani-group.png", width: 396, height: 161, alt: BRAND.group.name },
  tech: { src: "/logos/futani-tech.png", width: 142, height: 159, alt: BRAND.tech.name },
} as const;

export type BrandLogoVariant = keyof typeof BRAND_LOGOS;

interface BrandLogoProps {
  variant: BrandLogoVariant;
  /** Hauteur Tailwind (ex. « h-10 ») ; la largeur suit les proportions. */
  className?: string;
  /** Logo affiché au-dessus de la ligne de flottaison : chargé en priorité. */
  priority?: boolean;
}

/**
 * Logo d'une entité FUTANI, posé sur une pastille blanche : le bleu foncé du logo reste lisible
 * sur les fonds marine de l'en-tête, du pied de page et des panneaux de marque.
 */
export function BrandLogo({ variant, className, priority = false }: BrandLogoProps) {
  const logo = BRAND_LOGOS[variant];
  return (
    <span className="inline-flex rounded-lg bg-white px-2 py-1">
      <Image src={logo.src} alt={logo.alt} width={logo.width} height={logo.height} priority={priority} className={cn("h-10 w-auto", className)} />
    </span>
  );
}

interface LogoProps {
  shopName: string;
  logoUrl: string | null;
  priority?: boolean;
}

/** Logo de la boutique : logo téléversé dans l'administration, à défaut le logo officiel FUTANI SHOP. */
export function Logo({ shopName, logoUrl, priority = false }: LogoProps) {
  if (logoUrl) {
    // eslint-disable-next-line @next/next/no-img-element -- logo téléversé, servi par /medias
    return <img src={logoUrl} alt={shopName} className="h-9 w-auto" />;
  }
  return <BrandLogo variant="shop" priority={priority} />;
}
