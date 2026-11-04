import { BrandIcon } from "@/components/brand/brand-icon";
import { socialProfiles, type SocialLinks as StoredSocialLinks } from "@/lib/social-links";
import { cn } from "@/lib/utils";

interface SocialLinksProps {
  /** Liens enregistrés (paramètres « company ») : seuls ceux qui passent la validation sont affichés. */
  links: Readonly<StoredSocialLinks>;
  className?: string;
}

/**
 * Réseaux sociaux (pied de page) : un lien par profil conforme (src/lib/social-links.ts), ouvert dans
 * un nouvel onglet. Ne rend rien (ni titre ni liste) quand aucun lien valide n'existe.
 */
export function SocialLinks({ links, className }: SocialLinksProps) {
  const profiles = socialProfiles(links);
  if (profiles.length === 0) return null;
  return (
    <nav aria-label="Réseaux sociaux" className={cn("flex flex-col gap-3", className)}>
      <h2 className="text-sm font-semibold uppercase tracking-wide text-white">Suivez-nous</h2>
      <ul className="flex flex-wrap gap-2">
        {profiles.map(({ network, label, icon, href }) => (
          <li key={network}>
            {/* Pastille blanche : les logos des réseaux restent lisibles sur le fond marine. */}
            <a
              href={href}
              target="_blank"
              rel="noopener noreferrer"
              aria-label={`${label} (nouvel onglet)`}
              className="grid size-10 place-items-center rounded-full bg-white transition hover:scale-110 hover:ring-2 hover:ring-brand-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-accent focus-visible:ring-offset-2 focus-visible:ring-offset-brand-navy"
            >
              <BrandIcon name={icon} className="size-5" />
            </a>
          </li>
        ))}
      </ul>
    </nav>
  );
}
