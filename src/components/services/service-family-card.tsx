import Link from "next/link";
import { BrandIcon, type BrandIconName } from "@/components/brand/brand-icon";
import { serviceFamilyPath } from "@/lib/service-paths";

/** Pictogramme de chaque famille, par slug. */
const FAMILY_ICONS: Readonly<Record<string, BrandIconName>> = {
  "maintenance-informatique": "maintenance",
  "reseaux-informatiques": "reseau",
  videosurveillance: "video-surveillance",
  "developpement-web": "ordinateur",
};

/** Pictogramme des familles sans pictogramme propre (dont Électricité, en attendant le sien). */
const DEFAULT_FAMILY_ICON: BrandIconName = "innovation";

interface ServiceFamilyCardProps {
  slug: string;
  name: string;
  description: string | null;
}

/** Carte d'une famille de services : un seul lien vers sa page, utilisable sans JavaScript. */
export function ServiceFamilyCard({ slug, name, description }: ServiceFamilyCardProps) {
  return (
    <Link
      href={serviceFamilyPath(slug)}
      className="flex h-full flex-col gap-3 rounded-xl border border-line bg-surface p-5 hover:border-brand-blue"
    >
      <BrandIcon name={FAMILY_ICONS[slug] ?? DEFAULT_FAMILY_ICON} className="size-12" />
      <h2 className="text-lg font-semibold">{name}</h2>
      {description && <p className="text-sm text-ink-muted">{description}</p>}
      <span className="mt-auto text-sm font-semibold text-brand-blue">Découvrir les prestations</span>
    </Link>
  );
}
