import Link from "next/link";
import { JsonLd } from "@/components/seo/json-ld";
import { absoluteUrl } from "@/server/storefront";

export interface Crumb {
  label: string;
  href: string;
}

/** Fil d'Ariane accessible, avec ses données structurées BreadcrumbList. */
export function Breadcrumbs({ items }: { items: readonly Crumb[] }) {
  const trail = [{ label: "Accueil", href: "/" }, ...items];
  return (
    <nav aria-label="Fil d'Ariane" className="text-sm text-ink-muted">
      <ol className="flex flex-wrap items-center gap-1">
        {trail.map((crumb, index) => (
          <li key={crumb.href} className="flex items-center gap-1">
            {index > 0 && <span aria-hidden>/</span>}
            {index === trail.length - 1 ? (
              <span aria-current="page" className="text-ink">
                {crumb.label}
              </span>
            ) : (
              <Link href={crumb.href} className="hover:underline">
                {crumb.label}
              </Link>
            )}
          </li>
        ))}
      </ol>
      <JsonLd
        data={{
          "@context": "https://schema.org",
          "@type": "BreadcrumbList",
          itemListElement: trail.map((crumb, index) => ({
            "@type": "ListItem",
            position: index + 1,
            name: crumb.label,
            item: absoluteUrl(crumb.href),
          })),
        }}
      />
    </nav>
  );
}
