import Link from "next/link";
import { BrandIcon } from "@/components/brand/brand-icon";
import { AnnouncementRotator } from "@/components/layout/announcement-rotator";
import type { VisibleAnnouncement } from "@/server/modules/announcements/visibility";
import { getVisibleAnnouncements } from "@/server/storefront";

const linkClass = "underline decoration-brand-navy/40 underline-offset-2 hover:decoration-brand-navy";

/** Contenu d'une annonce : pictogramme décoratif, badge « Promo » pour une publicité, lien interne ou https. */
function Slide({ item }: { item: VisibleAnnouncement }) {
  const content = (
    <>
      <BrandIcon name={item.kind === "PROMOTION" ? "promo" : "info"} className="mr-1.5 inline-block size-5 align-text-bottom" />
      {item.kind === "PROMOTION" && <span className="mr-1.5 rounded bg-brand-navy px-1.5 py-0.5 text-xs font-bold uppercase text-white">Promo</span>}
      {item.text}
    </>
  );
  if (!item.href) return <p className="font-medium">{content}</p>;
  // Lien interne (« /… ») : navigation du site ; https : nouvel onglet, sans accès à la page d'origine.
  return item.href.startsWith("/") ? (
    <Link href={item.href} className={`${linkClass} font-medium`}>
      {content}
    </Link>
  ) : (
    <a href={item.href} target="_blank" rel="noopener noreferrer" className={`${linkClass} font-medium`}>
      {content}
    </a>
  );
}

/** Bandeau d'annonces et de promotions au-dessus de l'en-tête ; absent s'il n'y a rien à afficher. */
export async function AnnouncementBar() {
  const { items, rotationSeconds } = await getVisibleAnnouncements();
  if (items.length === 0) return null;
  return (
    <section aria-label="Annonces et promotions" className="bg-brand-accent text-sm text-brand-navy">
      <AnnouncementRotator slides={items.map((item) => <Slide key={item.id} item={item} />)} rotationSeconds={rotationSeconds} />
    </section>
  );
}
