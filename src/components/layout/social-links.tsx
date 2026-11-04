import { BrandIcon } from "@/components/brand/brand-icon";
import type { SocialProfile } from "@/lib/social-links";

interface SocialLinksProps {
  /** Profils déjà validés (socialProfiles) : un bouton par profil. */
  profiles: readonly SocialProfile[];
}

/**
 * Boutons des réseaux sociaux (section dédiée du pied de page) : icône seule, un lien par profil,
 * ouvert dans un nouvel onglet. Le titre et le repère de navigation viennent de la section parente.
 */
export function SocialLinks({ profiles }: SocialLinksProps) {
  return (
    <ul className="flex flex-wrap gap-2">
      {profiles.map(({ network, label, icon, href }) => (
        <li key={network}>
          {/* Fond blanc : les logos de X et de TikTok sont sombres et disparaîtraient sur le marine. */}
          <a
            href={href}
            target="_blank"
            rel="noopener noreferrer"
            aria-label={`${label} (nouvel onglet)`}
            className="grid size-11 place-items-center rounded-lg bg-white transition-colors motion-reduce:transition-none hover:bg-white/90 hover:ring-2 hover:ring-white/60 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-accent focus-visible:ring-offset-2 focus-visible:ring-offset-brand-navy"
          >
            <BrandIcon name={icon} className="size-6" />
          </a>
        </li>
      ))}
    </ul>
  );
}
