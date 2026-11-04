import { BrandIcon } from "@/components/brand/brand-icon";
import type { SocialButton } from "@/lib/social-links";

/**
 * Cadre commun des icônes du pied de page (réseaux sociaux et moyens de paiement) : un seul style pour les deux
 * blocs. Fond blanc du pied de page : cadre teinté de marine très léger (5 %) et fine bordure marine (15 %),
 * sans ombre ; les logos gardent leurs couleurs d'origine, sans halo.
 */
export const FOOTER_ICON_TILE =
  "grid size-11 shrink-0 place-items-center rounded-lg border border-brand-navy/15 bg-brand-navy/5";

interface SocialLinksProps {
  /** Les six réseaux (socialButtons) : href déjà validé, ou null quand il n'y a pas d'adresse valide. */
  buttons: readonly SocialButton[];
}

/**
 * Boutons des réseaux sociaux (section dédiée du pied de page) : icône seule. Avec adresse valide : un lien
 * ouvert dans un nouvel onglet ; sans adresse : une icône visible mais inerte (ni lien, ni bouton, ni focus).
 * Le titre et le repère de navigation éventuel viennent de la section parente.
 */
export function SocialLinks({ buttons }: SocialLinksProps) {
  return (
    <ul className="flex flex-wrap gap-2">
      {buttons.map(({ network, label, icon, href }) => (
        <li key={network}>
          {/* Cadre teinté partagé dans les deux cas ; l'état inactif garde ce cadre et s'atténue par l'opacité
              de l'ensemble (cadre et logo), sans grisé. */}
          {href ? (
            <a
              href={href}
              target="_blank"
              rel="noopener noreferrer"
              aria-label={`${label} (nouvel onglet)`}
              className={`${FOOTER_ICON_TILE} transition-colors motion-reduce:transition-none hover:bg-brand-navy/10 focus-visible:outline-none! focus-visible:ring-2 focus-visible:ring-brand-blue focus-visible:ring-offset-2 focus-visible:ring-offset-brand-bar`}
            >
              <BrandIcon name={icon} className="size-9" />
            </a>
          ) : (
            <span role="img" aria-label={`${label} (lien non disponible)`} className={`${FOOTER_ICON_TILE} opacity-60`}>
              <BrandIcon name={icon} className="size-9" />
            </span>
          )}
        </li>
      ))}
    </ul>
  );
}
