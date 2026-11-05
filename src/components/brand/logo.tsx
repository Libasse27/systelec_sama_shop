import Image from "next/image";
import { BRAND } from "@/lib/brand";
import { cn } from "@/lib/utils";

/** Logos officiels (fond détouré), servis depuis public/logos ; dimensions intrinsèques des fichiers. */
const BRAND_LOGOS = {
  shop: { src: "/logos/futani-shop.png", width: 354, height: 146, alt: BRAND.shop.name },
  group: { src: "/logos/futani-group.png", width: 396, height: 161, alt: BRAND.group.name },
  tech: { src: "/logos/futani-tech.png", width: 142, height: 159, alt: BRAND.tech.name },
} as const;

/**
 * Éléments du logo FUTANI SHOP découpés dans futani-shop.png (pixels copiés tels quels, 2 px transparents
 * de marge) pour le navbar sur grand écran : l'emblème (F et chariot) dépasse sous le navbar, le texte reste dessus.
 * Dimensions intrinsèques des fichiers.
 */
const HEADER_LOGO_PARTS = {
  emblem: { src: "/logos/futani-shop-embleme.png", width: 179, height: 149 },
  text: { src: "/logos/futani-shop-texte.png", width: 177, height: 75 },
} as const;

export type BrandLogoVariant = keyof typeof BRAND_LOGOS;

interface BrandLogoProps {
  variant: BrandLogoVariant;
  /** Hauteur Tailwind (ex. « h-10 ») ; la largeur suit les proportions. */
  className?: string;
  /** Logo affiché au-dessus de la ligne de flottaison : chargé en priorité. */
  priority?: boolean;
  /** Sans pastille blanche et décoratif (alt vide) : navbar, où le lien parent porte déjà le nom. */
  bare?: boolean;
}

/**
 * Logo d'une entité FUTANI, posé sur une pastille blanche : le bleu foncé du logo reste lisible
 * sur les fonds marine des panneaux de marque (sans effet visible sur le fond blanc du pied de page).
 */
export function BrandLogo({ variant, className, priority = false, bare = false }: BrandLogoProps) {
  const logo = BRAND_LOGOS[variant];
  if (bare) {
    return <Image src={logo.src} alt="" width={logo.width} height={logo.height} priority={priority} className={cn("h-10 w-auto", className)} />;
  }
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

/**
 * Logo du navbar, sans pastille ni fond ajouté (PNG détouré, couleurs d'origine). Logo téléversé : celui de `Logo`.
 * Sinon, sous « lg », le logo complet ; à partir de « lg », l'emblème (96 px de haut, haut à 6 px du haut du navbar,
 * donc 28 px sous le navbar) et le texte à côté. Le texte est descendu comme dans le logo d'origine (où il occupe le
 * bas de l'emblème), mais gardé dans le navbar avec 4 px de marge : son bas est à 70 px du haut du navbar de 74 px.
 * Les images sont décoratives : le lien parent porte le nom accessible.
 * Largeurs serrées sous « xl » (texte réduit, marge négative à gauche) : à 1024 px, connecté avec le rôle ADMIN,
 * le navbar doit tenir sur une seule ligne (vérifié par e2e/footer.spec.ts).
 * Prérequis : l'ancêtre positionné est le conteneur du navbar (haut de l'en-tête), qui ne coupe pas son contenu.
 * Pas de « priority » : préchargées, les deux versions seraient téléchargées à toute largeur ; en chargement différé,
 * la version masquée (display: none) ne l'est pas.
 */
export function HeaderLogo({ shopName, logoUrl }: Omit<LogoProps, "priority">) {
  if (logoUrl) return <Logo shopName={shopName} logoUrl={logoUrl} />;
  const { emblem, text } = HEADER_LOGO_PARTS;
  return (
    <>
      {/* Hauteur minimale 50 px : le navbar garde ses deux lignes (126 px) malgré la disparition de la pastille. */}
      <span className="flex min-h-[50px] items-center lg:hidden">
        <BrandLogo variant="shop" bare className="h-12" />
      </span>
      {/* Hauteur minimale 50 px : le navbar garde ses 74 px (2 × 12 px de marge + 50 px). */}
      <span className="hidden min-h-[50px] items-center gap-0.5 lg:-ml-3 lg:flex xl:ml-0">
        {/* Réserve dans le flux la largeur de l'emblème (96 px × 179/149). */}
        <span aria-hidden className="block h-1 w-[116px] shrink-0" />
        {/* Sans « left » : l'emblème reste à sa position naturelle, au début du lien. z-10 : au-dessus du contenu
            de la page, sous le menu Catalogue (z-20) et la recherche déployée (z-30). */}
        <Image src={emblem.src} alt="" width={emblem.width} height={emblem.height} className="absolute top-1.5 z-10 block h-24 w-auto" />
        {/* Texte centré dans la ligne (centre à 37 px) puis descendu : bas à 70 px, soit 32 px de haut (lg, décalage
            17 px) ou 48 px de haut (xl, décalage 9 px). */}
        <Image
          src={text.src}
          alt=""
          width={text.width}
          height={text.height}
          className="relative top-[17px] block h-8 w-auto xl:top-[9px] xl:h-12"
        />
      </span>
    </>
  );
}
