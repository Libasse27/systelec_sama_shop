import Link from "next/link";
import { PRODUCT_STATUS_LABELS } from "@/lib/labels";
import { cn } from "@/lib/utils";

export function PageHeader({ title, children }: { title: string; children?: React.ReactNode }) {
  return (
    <div className="mb-6 flex flex-wrap items-center justify-between gap-3">
      <h1 className="text-2xl font-bold">{title}</h1>
      {children && <div className="flex flex-wrap gap-2">{children}</div>}
    </div>
  );
}

export function Section({ title, children, id }: { title: string; children: React.ReactNode; id?: string }) {
  const headingId = `${id ?? title.replace(/\W+/g, "-").toLowerCase()}-titre`;
  return (
    <section aria-labelledby={headingId} className="rounded-xl border border-line bg-surface p-4 sm:p-5">
      <h2 id={headingId} className="mb-4 text-lg font-semibold">
        {title}
      </h2>
      {children}
    </section>
  );
}

export const linkButtonClass =
  "inline-flex items-center rounded-lg bg-brand-blue px-4 py-2 text-sm font-semibold text-white hover:bg-brand-blue-dark";
export const secondaryLinkClass =
  "inline-flex items-center rounded-lg border border-line bg-surface px-4 py-2 text-sm font-semibold hover:bg-surface-muted";

const STATUS_STYLES = {
  DRAFT: "bg-amber-100 text-amber-900",
  PUBLISHED: "bg-green-100 text-green-900",
  ARCHIVED: "bg-slate-200 text-slate-700",
} as const;

export function StatusBadge({ status }: { status: keyof typeof STATUS_STYLES }) {
  return <span className={cn("rounded-md px-2 py-0.5 text-xs font-semibold", STATUS_STYLES[status])}>{PRODUCT_STATUS_LABELS[status]}</span>;
}

/** Pagination par liens (fonctionne sans JavaScript), paramètres de recherche conservés. */
export function Pagination({
  basePath,
  params,
  page,
  pageCount,
}: {
  basePath: string;
  params: Record<string, string | undefined>;
  page: number;
  pageCount: number;
}) {
  if (pageCount <= 1) return null;
  const href = (target: number) => {
    const query = new URLSearchParams(
      Object.entries({ ...params, page: target > 1 ? String(target) : undefined }).filter((entry): entry is [string, string] => Boolean(entry[1])),
    );
    const search = query.toString();
    return search ? `${basePath}?${search}` : basePath;
  };
  return (
    <nav aria-label="Pagination" className="mt-4 flex items-center justify-between gap-2 text-sm">
      {page > 1 ? (
        <Link href={href(page - 1)} className={secondaryLinkClass}>
          Précédent
        </Link>
      ) : (
        <span />
      )}
      <span className="text-ink-muted">
        Page {page} sur {pageCount}
      </span>
      {page < pageCount ? (
        <Link href={href(page + 1)} className={secondaryLinkClass}>
          Suivant
        </Link>
      ) : (
        <span />
      )}
    </nav>
  );
}

/** Lit un numéro de page dans les paramètres d'URL (1 par défaut). */
export function pageParam(value: string | string[] | undefined): number {
  const page = Number(Array.isArray(value) ? value[0] : value);
  return Number.isInteger(page) && page > 0 ? page : 1;
}

export function stringParam(value: string | string[] | undefined): string | undefined {
  const text = Array.isArray(value) ? value[0] : value;
  return text?.trim() ? text.trim() : undefined;
}
