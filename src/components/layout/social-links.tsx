import { BrandIcon } from "@/components/brand/brand-icon";
import { socialProfiles, type SocialLinks as StoredSocialLinks } from "@/lib/social-links";

interface SocialLinksProps {
  /** Liens enregistrés (paramètres « company ») : seuls ceux qui passent la validation sont affichés. */
  links: Readonly<StoredSocialLinks>;
}

/**
 * Réseaux sociaux (colonne de la marque du pied de page) : petites icônes en ligne, sans titre, un lien
 * par profil conforme (src/lib/social-links.ts), ouvert dans un nouvel onglet. Ne rend rien quand aucun
 * lien valide n'existe.
 */
export function SocialLinks({ links }: SocialLinksProps) {
  const profiles = socialProfiles(links);
  if (profiles.length === 0) return null;
  return (
    <nav aria-label="Réseaux sociaux">
      <ul className="flex flex-wrap gap-2">
        {profiles.map(({ network, label, icon, href }) => (
          <li key={network}>
            {/* Pastille blanche : les logos des réseaux restent lisibles sur le fond marine. */}
            <a
              href={href}
              target="_blank"
              rel="noopener noreferrer"
              aria-label={`${label} (nouvel onglet)`}
              className="grid size-8 place-items-center rounded-full bg-white transition hover:scale-110 hover:ring-2 hover:ring-brand-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-accent focus-visible:ring-offset-2 focus-visible:ring-offset-brand-navy"
            >
              <BrandIcon name={icon} className="size-4" />
            </a>
          </li>
        ))}
      </ul>
    </nav>
  );
}
