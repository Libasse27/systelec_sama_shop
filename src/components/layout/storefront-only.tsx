"use client";

import { usePathname } from "next/navigation";
import { isAdminPath } from "@/lib/routes";

/**
 * Affiche son contenu sur la boutique publique uniquement (jamais sous /admin). Côté client : la mise en
 * page racine n'est pas recalculée lors d'une navigation interne, seul usePathname suit le changement
 * de page (et il est déjà connu au rendu serveur : pas d'apparition fugace).
 */
export function StorefrontOnly({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  return isAdminPath(pathname) ? null : children;
}
