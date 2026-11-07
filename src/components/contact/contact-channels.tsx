import { BrandIcon, type BrandIconName } from "@/components/brand/brand-icon";
import { mailtoHref, telHref, whatsappHref } from "@/lib/contact-links";

interface ContactChannelsProps {
  /** Coordonnées brutes des paramètres de l'entreprise : null ou invalides, la carte devient inactive. */
  email: string | null;
  whatsapp: string | null;
  phone: string | null;
}

interface ChannelCard {
  key: string;
  icon: BrandIconName;
  label: string;
  value: string | null;
  /** Lien validé ; null quand la coordonnée est absente ou inutilisable. */
  href: string | null;
  newTab?: boolean;
}

const CARD_CLASS = "flex h-full min-h-11 items-center gap-3 rounded-xl border border-line p-4";
const ACTIVE_CARD_CLASS = `${CARD_CLASS} bg-surface transition-colors motion-reduce:transition-none hover:border-brand-blue`;
const INACTIVE_CARD_CLASS = `${CARD_CLASS} bg-surface-muted`;

/** Section « Contactez-nous directement » : e-mail, WhatsApp, téléphone, dans cet ordre, toujours trois cartes. */
export function ContactChannels({ email, whatsapp, phone }: ContactChannelsProps) {
  const cards: ChannelCard[] = [
    { key: "email", icon: "email", label: "Par e-mail", value: email, href: email ? mailtoHref(email) : null },
    { key: "whatsapp", icon: "whatsapp", label: "Par WhatsApp", value: whatsapp, href: whatsapp ? whatsappHref(whatsapp) : null, newTab: true },
    { key: "phone", icon: "telephone", label: "Par téléphone", value: phone, href: phone ? telHref(phone) : null },
  ];

  return (
    <section aria-labelledby="canaux-contact" className="flex flex-col gap-3">
      <h2 id="canaux-contact" className="text-lg font-semibold">
        Contactez-nous directement
      </h2>
      <ul className="grid gap-3 md:grid-cols-3">
        {cards.map((card) => (
          <li key={card.key}>
            <Card card={card} />
          </li>
        ))}
      </ul>
    </section>
  );
}

function Card({ card }: { card: ChannelCard }) {
  const { icon, label, value, href, newTab } = card;
  if (!href || !value) {
    // Carte inerte : ni lien, ni focus. Le texte garde son contraste, seule l'icône est atténuée.
    return (
      <div className={INACTIVE_CARD_CLASS}>
        <BrandIcon name={icon} className="size-8 shrink-0 opacity-50" />
        <div className="min-w-0">
          <p className="font-semibold">{label}</p>
          <p className="text-sm text-ink-muted">Bientôt disponible</p>
        </div>
      </div>
    );
  }
  return (
    <a href={href} className={ACTIVE_CARD_CLASS} {...(newTab ? { target: "_blank", rel: "noopener noreferrer" } : {})}>
      <BrandIcon name={icon} className="size-8 shrink-0" />
      <div className="min-w-0">
        <p className="font-semibold">{label}</p>
        <p className="break-words text-sm font-medium text-brand-blue-dark underline">{value}</p>
        {newTab && <span className="sr-only"> (nouvel onglet)</span>}
      </div>
    </a>
  );
}
