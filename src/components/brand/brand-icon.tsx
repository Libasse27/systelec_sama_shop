import Image from "next/image";
import { cn } from "@/lib/utils";

/** Pictogrammes FUTANI (fond détouré), servis depuis public/icones. */
export type BrandIconName =
  | "boutique"
  | "casque"
  | "cle-usb"
  | "email"
  | "especes"
  | "facture"
  | "info"
  | "innovation"
  | "livraison"
  | "localisation"
  | "maintenance"
  | "mon-compte"
  | "ordinateur"
  | "panier"
  | "promo"
  | "recherche"
  | "reseau"
  | "securite"
  | "succes"
  | "telephone"
  | "video-surveillance"
  | "whatsapp";

/**
 * Boîte de référence pour next/image (les sources font de 39 à 150 px, non carrées) : la taille
 * affichée vient toujours de la classe « size-* », object-contain préservant les proportions.
 */
const SOURCE_SIZE = 96;

interface BrandIconProps {
  name: BrandIconName;
  /** Taille Tailwind (ex. « size-5 ») et marges ; l'image garde ses proportions. */
  className?: string;
}

/** Pictogramme décoratif : le texte voisin porte le sens, l'image est masquée aux lecteurs d'écran. */
export function BrandIcon({ name, className }: BrandIconProps) {
  return (
    <Image
      src={`/icones/${name}.png`}
      alt=""
      aria-hidden
      width={SOURCE_SIZE}
      height={SOURCE_SIZE}
      className={cn("shrink-0 object-contain", className)}
    />
  );
}
