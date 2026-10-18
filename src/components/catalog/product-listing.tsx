import Link from "next/link";
import { listingHref, SORT_OPTIONS, type ListingParams } from "@/server/modules/catalog/listing-params";
import type { ProductPage } from "@/server/modules/catalog/queries";
import { ProductGrid } from "./product-card";

interface ProductListingProps {
  basePath: string;
  params: ListingParams;
  result: ProductPage;
  brands: readonly { slug: string; name: string }[];
}

const inputClass = "rounded-lg border border-line bg-surface px-3 py-2 text-sm";
const RESET: Partial<ListingParams> = {
  tri: "pertinence",
  min: undefined,
  max: undefined,
  dispo: false,
  marque: undefined,
  page: 1,
};

/** Filtres en formulaire GET : fonctionnent sans JavaScript et donnent des URL partageables. */
function Filters({ basePath, params, brands }: Omit<ProductListingProps, "result">) {
  return (
    <form
      action={basePath}
      method="get"
      className="grid grid-cols-2 gap-3 rounded-xl border border-line bg-surface p-4 sm:grid-cols-6"
    >
      {params.q && <input type="hidden" name="q" value={params.q} />}
      <label className="col-span-2 flex flex-col gap-1 text-sm">
        Trier par
        <select name="tri" defaultValue={params.tri} className={inputClass}>
          {Object.entries(SORT_OPTIONS).map(([value, label]) => (
            <option key={value} value={value}>
              {label}
            </option>
          ))}
        </select>
      </label>
      {brands.length > 0 && (
        <label className="col-span-2 flex flex-col gap-1 text-sm">
          Marque
          <select name="marque" defaultValue={params.marque ?? ""} className={inputClass}>
            <option value="">Toutes</option>
            {brands.map((brand) => (
              <option key={brand.slug} value={brand.slug}>
                {brand.name}
              </option>
            ))}
          </select>
        </label>
      )}
      <label className="flex flex-col gap-1 text-sm">
        Prix min (FCFA)
        <input type="number" name="min" min={0} step={500} inputMode="numeric" defaultValue={params.min} className={inputClass} />
      </label>
      <label className="flex flex-col gap-1 text-sm">
        Prix max (FCFA)
        <input type="number" name="max" min={0} step={500} inputMode="numeric" defaultValue={params.max} className={inputClass} />
      </label>
      <label className="col-span-2 flex items-center gap-2 text-sm sm:col-span-3">
        <input type="checkbox" name="dispo" value="1" defaultChecked={params.dispo} className="size-4" />
        Disponibles uniquement
      </label>
      <div className="col-span-2 flex items-center justify-end gap-3 sm:col-span-3">
        <Link href={listingHref(basePath, params, RESET)} className="text-sm text-brand-blue underline">
          Réinitialiser
        </Link>
        <button
          type="submit"
          className="rounded-lg bg-brand-blue px-4 py-2 text-sm font-semibold text-white hover:bg-brand-blue-dark"
        >
          Appliquer
        </button>
      </div>
    </form>
  );
}

function Pagination({ basePath, params, result }: Omit<ProductListingProps, "brands">) {
  if (result.pageCount <= 1) return null;
  const link = (page: number, label: string, rel: string) => (
    <Link
      href={listingHref(basePath, params, { page })}
      rel={rel}
      className="rounded-lg border border-line bg-surface px-3 py-2 text-sm hover:bg-surface-muted"
    >
      {label}
    </Link>
  );
  return (
    <nav aria-label="Pagination" className="flex items-center justify-center gap-3">
      {result.page > 1 && link(result.page - 1, "Page précédente", "prev")}
      <span className="text-sm text-ink-muted">
        Page {result.page} sur {result.pageCount}
      </span>
      {result.page < result.pageCount && link(result.page + 1, "Page suivante", "next")}
    </nav>
  );
}

export function ProductListing(props: ProductListingProps) {
  const { result } = props;
  return (
    <div className="flex flex-col gap-5">
      <Filters basePath={props.basePath} params={props.params} brands={props.brands} />
      <p className="text-sm text-ink-muted" role="status">
        {result.total === 0 ? "Aucun produit ne correspond." : `${result.total} produit${result.total > 1 ? "s" : ""}`}
      </p>
      {result.items.length > 0 && <ProductGrid products={result.items} />}
      <Pagination basePath={props.basePath} params={props.params} result={result} />
    </div>
  );
}
