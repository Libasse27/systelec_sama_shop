import { Package } from "lucide-react";
import Link from "next/link";
import { availability, conditionLabel } from "@/lib/labels";
import { formatFcfa } from "@/lib/money";
import { cn } from "@/lib/utils";
import type { ProductCard as ProductCardData } from "@/server/modules/catalog/queries";

export function Price({ price, compareAtPrice, size = "md" }: { price: number; compareAtPrice: number | null; size?: "md" | "lg" }) {
  return (
    <p className="flex flex-wrap items-baseline gap-x-2">
      <span className={cn("font-bold text-brand-navy", size === "lg" ? "text-2xl" : "text-lg")}>{formatFcfa(price)}</span>
      {compareAtPrice !== null && (
        <span className="text-sm text-ink-muted line-through">
          <span className="sr-only">Prix habituel : </span>
          {formatFcfa(compareAtPrice)}
        </span>
      )}
    </p>
  );
}

const AVAILABILITY_STYLES = {
  "in-stock": "bg-green-50 text-green-800",
  low: "bg-amber-50 text-amber-900",
  out: "bg-surface-muted text-ink-muted",
} as const;

export function AvailabilityBadge({ available }: { available: number }) {
  const { level, label } = availability(available);
  return (
    <span className={cn("inline-flex rounded-md px-2 py-0.5 text-xs font-medium", AVAILABILITY_STYLES[level])}>
      {label}
    </span>
  );
}

export function ProductImage({ image, name }: { image: { url: string; alt: string } | null; name: string }) {
  if (!image) {
    return (
      <div className="grid aspect-square place-items-center rounded-lg bg-surface-muted" role="img" aria-label={name}>
        <Package aria-hidden className="size-10 text-ink-muted" />
      </div>
    );
  }
  return (
    // eslint-disable-next-line @next/next/no-img-element -- images administrables, domaine fixé en phase 5
    <img src={image.url} alt={image.alt} loading="lazy" className="aspect-square w-full rounded-lg object-cover" />
  );
}

/** Carte produit des listes : seules des données publiques (DTO ProductCard). */
export function ProductCard({ product }: { product: ProductCardData }) {
  return (
    <article className="flex h-full flex-col gap-2 rounded-xl border border-line bg-surface p-3">
      <Link href={`/produits/${product.slug}`} className="flex flex-col gap-2">
        <ProductImage image={product.image} name={product.name} />
        <h3 className="line-clamp-2 text-sm font-semibold hover:underline">{product.name}</h3>
      </Link>
      <p className="text-xs text-ink-muted">
        {[product.brand, product.condition !== "NEW" ? conditionLabel(product.condition) : null].filter(Boolean).join(" · ")}
      </p>
      <div className="mt-auto flex flex-col gap-1">
        <Price price={product.price} compareAtPrice={product.compareAtPrice} />
        <AvailabilityBadge available={product.available} />
      </div>
    </article>
  );
}

export function ProductGrid({ products }: { products: readonly ProductCardData[] }) {
  return (
    <ul className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4">
      {products.map((product) => (
        <li key={product.slug}>
          <ProductCard product={product} />
        </li>
      ))}
    </ul>
  );
}
