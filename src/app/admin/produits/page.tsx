import type { Metadata } from "next";
import Link from "next/link";
import { linkButtonClass, PageHeader, Pagination, pageParam, StatusBadge, stringParam } from "@/components/admin/admin-ui";
import { PRODUCT_STATUS_LABELS } from "@/lib/labels";
import { formatFcfa } from "@/lib/money";
import { requirePermission } from "@/server/auth/session";
import { db } from "@/server/db/client";
import { listAdminProducts, parseStatusFilter } from "@/server/modules/catalog/admin-queries";

export const metadata: Metadata = { title: "Produits", robots: { index: false } };

type SearchParams = Promise<Record<string, string | string[] | undefined>>;

export default async function AdminProductsPage({ searchParams }: { searchParams: SearchParams }) {
  const user = await requirePermission("products.read", "/admin/produits");
  const params = await searchParams;
  const q = stringParam(params.q);
  const status = parseStatusFilter(stringParam(params.statut));
  const { rows, total, page, pageCount } = await listAdminProducts(db, user, { q, status, page: pageParam(params.page) });

  return (
    <>
      <PageHeader title="Produits">
        {user.permissions.has("products.create") && (
          <Link href="/admin/produits/nouveau" className={linkButtonClass}>
            Nouveau produit
          </Link>
        )}
      </PageHeader>

      <form method="get" role="search" className="mb-4 flex flex-wrap items-end gap-3">
        <div className="flex min-w-48 flex-1 flex-col gap-1">
          <label htmlFor="recherche-produits" className="text-sm font-medium">
            Rechercher
          </label>
          <input id="recherche-produits" name="q" type="search" defaultValue={q} placeholder="Nom, modèle ou SKU" className="rounded-lg border border-line px-3 py-2" />
        </div>
        <div className="flex flex-col gap-1">
          <label htmlFor="filtre-statut" className="text-sm font-medium">
            Statut
          </label>
          <select id="filtre-statut" name="statut" defaultValue={status ?? ""} className="rounded-lg border border-line px-3 py-2">
            <option value="">Tous</option>
            {Object.entries(PRODUCT_STATUS_LABELS).map(([value, label]) => (
              <option key={value} value={value}>
                {label}
              </option>
            ))}
          </select>
        </div>
        <button type="submit" className="rounded-lg border border-line px-4 py-2 text-sm font-semibold hover:bg-surface-muted">
          Filtrer
        </button>
      </form>

      <p className="mb-2 text-sm text-ink-muted">{total} produit(s)</p>
      {rows.length === 0 ? (
        <p className="rounded-xl border border-line bg-surface p-6 text-center text-ink-muted">Aucun produit ne correspond.</p>
      ) : (
        <div className="overflow-x-auto rounded-xl border border-line bg-surface">
          <table className="w-full text-left text-sm">
            <thead className="bg-surface-muted text-xs uppercase text-ink-muted">
              <tr>
                <th scope="col" className="px-3 py-2">Produit</th>
                <th scope="col" className="px-3 py-2">Statut</th>
                <th scope="col" className="px-3 py-2">Catégorie</th>
                <th scope="col" className="px-3 py-2 text-right">Prix</th>
                <th scope="col" className="px-3 py-2 text-right">Disponible</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((row) => (
                <tr key={row.id} className="border-t border-line">
                  <td className="px-3 py-2">
                    <Link href={`/admin/produits/${row.id}`} className="font-medium text-brand-blue underline-offset-2 hover:underline">
                      {row.name}
                    </Link>
                    <div className="text-xs text-ink-muted">
                      {row.sku}
                      {row.variantCount > 1 && ` · ${row.variantCount} versions`}
                      {!row.hasImage && " · sans image"}
                    </div>
                  </td>
                  <td className="px-3 py-2">
                    <StatusBadge status={row.status} />
                  </td>
                  <td className="px-3 py-2">{row.category}</td>
                  <td className="px-3 py-2 text-right whitespace-nowrap">{row.price === null ? "—" : formatFcfa(row.price)}</td>
                  <td className={`px-3 py-2 text-right ${row.available <= 0 ? "font-semibold text-red-700" : ""}`}>{row.available}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      <Pagination basePath="/admin/produits" params={{ q, statut: status }} page={page} pageCount={pageCount} />
    </>
  );
}
