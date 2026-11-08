"use client";

import { usePathname } from "next/navigation";
import { isTechPath } from "@/lib/routes";

interface SiteSpaceSwitchProps {
  /** Contenu affiché sur la boutique FUTANI SHOP. */
  shop: React.ReactNode;
  /** Contenu affiché dans la rubrique Services (FUTANI TECH). */
  tech: React.ReactNode;
}

/**
 * Choisit le contenu de l'espace courant. Côté client, comme StorefrontOnly : la mise en page racine n'est pas
 * recalculée lors d'une navigation interne, seul usePathname suit le changement de page (déjà connu au rendu
 * serveur : pas de bascule visible au chargement). Les deux contenus sont rendus côté serveur et passés en props.
 */
export function SiteSpaceSwitch({ shop, tech }: SiteSpaceSwitchProps) {
  const pathname = usePathname();
  return isTechPath(pathname) ? tech : shop;
}
