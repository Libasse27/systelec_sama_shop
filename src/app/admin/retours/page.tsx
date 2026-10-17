import type { Metadata } from "next";
import Link from "next/link";
import { PageHeader, Pagination, pageParam, stringParam } from "@/components/admin/admin-ui";
import { formatDateTime } from "@/lib/dates";
import { RETURN_STATUS_LABELS } from "@/lib/labels";
import { formatFcfa } from "@/lib/money";
import { requirePermission } from "@/server/auth/session";
import { db } from "@/server/db/client";
import { listReturns, parseReturnStatus } from "@/server/modules/returns/queries";

export const metadata: Metadata = { title: "Retours", robots: { index: false } };

type SearchParams = Promise<Record<string, string | string[] | undefined>>;

/** Retours : à vérifier et à rembourser d'abord. Ils s'enregistrent depuis la fiche d'une commande remise. */
export default async function ReturnsPage({ searchParams }: { searchParams: SearchParams }) {
  const user = await requirePermission("orders.read", "/admin/retours");
  const params = await searchParams;
  const status = parseReturnStatus(stringParam(params.statut));
  const { rows, total, page, pageCount } = await listReturns(db, user, { status, page: pageParam(params.page) });

  return (
    <>
      <PageHeader title="Retours" />
      <p className="-mt-4 mb-4 text-sm text-ink-muted">Un retour s&apos;enregistre depuis la fiche d&apos;une commande remise au client.</p>
      <form method="get" className="mb-4 flex flex-wrap items-end gap-3">
        <div className="flex flex-col gap-1">
          <label htmlFor="filtre-statut-retour" className="text-sm font-medium">
            Statut
          </label>
          <select id="filtre-statut-retour" name="statut" defaultValue={status ?? ""} className="rounded-lg border border-line px-3 py-2">
            <option value="">À traiter (à vérifier, à rembourser)</option>
            {Object.entries(RETURN_STATUS_LABELS).map(([value, label]) => (
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
      <p className="mb-2 text-sm text-ink-muted">{total} retour(s)</p>
      {rows.length === 0 ? (
        <p className="rounded-xl border border-line bg-surface p-6 text-center text-ink-muted">Aucun retour.</p>
      ) : (
        <div className="overflow-x-auto rounded-xl border border-line bg-surface">
          <table className="w-full text-left text-sm">
            <thead className="bg-surface-muted text-xs uppercase text-ink-muted">
              <tr>
                <th scope="col" className="px-3 py-2">Retour</th>
                <th scope="col" className="px-3 py-2">Commande</th>
                <th scope="col" className="px-3 py-2">Statut</th>
                <th scope="col" className="px-3 py-2 text-right">Valeur</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((row) => (
                <tr key={row.id} className="border-t border-line">
                  <td className="px-3 py-2">
                    {row.number}
                    <div className="text-xs text-ink-muted">{formatDateTime(row.createdAt)}</div>
                  </td>
                  <td className="px-3 py-2">
                    <Link href={`/admin/commandes/${row.orderId}`} className="font-medium text-brand-blue underline-offset-2 hover:underline">
                      {row.orderNumber}
                    </Link>
                    <div className="text-xs text-ink-muted">{row.customerName}</div>
                  </td>
                  <td className="px-3 py-2">
                    {RETURN_STATUS_LABELS[row.status]}
                    {row.refundAmount > 0 && <div className="text-xs text-ink-muted">Remboursement {formatFcfa(row.refundAmount)}</div>}
                  </td>
                  <td className="whitespace-nowrap px-3 py-2 text-right">{formatFcfa(row.itemsValue)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      <Pagination basePath="/admin/retours" params={{ statut: status }} page={page} pageCount={pageCount} />
    </>
  );
}
