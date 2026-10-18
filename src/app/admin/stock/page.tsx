import type { Metadata } from "next";
import Link from "next/link";
import { PageHeader, Pagination, pageParam, secondaryLinkClass, stringParam } from "@/components/admin/admin-ui";
import { formatDate } from "@/lib/dates";
import { requirePermission } from "@/server/auth/session";
import { db } from "@/server/db/client";
import { listInventory } from "@/server/modules/inventory/queries";

export const metadata: Metadata = { title: "Stock", robots: { index: false } };

type SearchParams = Promise<Record<string, string | string[] | undefined>>;

export default async function AdminStockPage({ searchParams }: { searchParams: SearchParams }) {
  const user = await requirePermission("inventory.read", "/admin/stock");
  const params = await searchParams;
  const q = stringParam(params.q);
  const alertsOnly = stringParam(params.alertes) === "1";
  const { rows, total, page, pageCount } = await listInventory(db, user, { q, alertsOnly, page: pageParam(params.page) });

  return (
    <>
      <PageHeader title="Stock">
        <Link href="/admin/stock/journal" className={secondaryLinkClass}>
          Journal des mouvements
        </Link>
      </PageHeader>

      <form method="get" role="search" className="mb-4 flex flex-wrap items-end gap-3">
        <div className="flex min-w-48 flex-1 flex-col gap-1">
          <label htmlFor="recherche-stock" className="text-sm font-medium">
            Rechercher
          </label>
          <input id="recherche-stock" name="q" type="search" defaultValue={q} placeholder="Produit, version ou SKU" className="rounded-lg border border-line px-3 py-2" />
        </div>
        <label className="flex items-center gap-2 pb-2 text-sm">
          <input type="checkbox" name="alertes" value="1" defaultChecked={alertsOnly} className="size-4" />
          Seulement les alertes
        </label>
        <button type="submit" className="rounded-lg border border-line px-4 py-2 text-sm font-semibold hover:bg-surface-muted">
          Filtrer
        </button>
      </form>

      <p className="mb-2 text-sm text-ink-muted">
        {total} version(s) {alertsOnly ? "en alerte (disponible ≤ seuil)" : "en vente"}
      </p>
      {rows.length === 0 ? (
        <p className="rounded-xl border border-line bg-surface p-6 text-center text-ink-muted">
          {alertsOnly ? "Aucune alerte de stock." : "Aucune version ne correspond."}
        </p>
      ) : (
        <div className="overflow-x-auto rounded-xl border border-line bg-surface">
          <table className="w-full text-left text-sm">
            <thead className="bg-surface-muted text-xs uppercase text-ink-muted">
              <tr>
                <th scope="col" className="px-3 py-2">Produit</th>
                <th scope="col" className="px-3 py-2 text-right">Physique</th>
                <th scope="col" className="px-3 py-2 text-right">Réservé</th>
                <th scope="col" className="px-3 py-2 text-right">Disponible</th>
                <th scope="col" className="px-3 py-2 text-right">Seuil</th>
                <th scope="col" className="px-3 py-2">Dernier inventaire</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((row) => (
                <tr key={row.variantId} className="border-t border-line">
                  <td className="px-3 py-2">
                    <Link href={`/admin/stock/${row.variantId}`} className="font-medium text-brand-blue underline-offset-2 hover:underline">
                      {row.productName}
                    </Link>
                    <div className="text-xs text-ink-muted">
                      {row.variantName} · <span className="font-mono">{row.sku}</span>
                    </div>
                  </td>
                  <td className="px-3 py-2 text-right">{row.onHand}</td>
                  <td className="px-3 py-2 text-right">{row.reserved}</td>
                  <td className={`px-3 py-2 text-right font-semibold ${row.available <= row.alertThreshold ? "text-red-700" : ""}`}>{row.available}</td>
                  <td className="px-3 py-2 text-right">{row.alertThreshold}</td>
                  <td className="px-3 py-2">{row.lastCountedAt ? formatDate(row.lastCountedAt) : "—"}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      <Pagination basePath="/admin/stock" params={{ q, alertes: alertsOnly ? "1" : undefined }} page={page} pageCount={pageCount} />
    </>
  );
}
