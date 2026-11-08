import Image from "next/image";
import Link from "next/link";
import { BrandIcon, type BrandIconName } from "@/components/brand/brand-icon";
import { serviceFamilyPath } from "@/lib/service-paths";

/** Familles dotées d'une icône propre, servie depuis public/icones/services/<slug>.png. */
const FAMILIES_WITH_ICON: ReadonlySet<string> = new Set([
  "maintenance-informatique",
  "reseaux-informatiques",
  "videosurveillance",
  "electricite",
  "developpement-web",
]);

/** Pictogramme d'une famille sans icône propre (par exemple une famille ajoutée plus tard). */
const DEFAULT_FAMILY_ICON: BrandIconName = "innovation";

/** Boîte d'affichage commune (px) : les sources n'ont pas toutes les mêmes proportions. */
const ICON_WIDTH = 144;
const ICON_HEIGHT = 96;

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
      {FAMILIES_WITH_ICON.has(slug) ? (
        <Image
          src={`/icones/services/${slug}.png`}
          alt=""
          aria-hidden
          width={ICON_WIDTH}
          height={ICON_HEIGHT}
          className="h-24 w-36 object-contain object-left"
        />
      ) : (
        <BrandIcon name={DEFAULT_FAMILY_ICON} className="size-12" />
      )}
      <h2 className="text-lg font-semibold">{name}</h2>
      {description && <p className="text-sm text-ink-muted">{description}</p>}
      <span className="mt-auto text-sm font-semibold text-brand-blue">Découvrir les prestations</span>
    </Link>
  );
}
