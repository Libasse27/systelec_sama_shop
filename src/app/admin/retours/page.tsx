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
  const late = stringParam(params.delai) === "hors";
  const { rows, total, page, pageCount } = await listReturns(db, user, { status, late, page: pageParam(params.page) });

  return (
    <>
      <PageHeader title="Retours" />
      <p className="-mt-4 mb-4 text-sm text-ink-muted">
        Un retour se déclare depuis la fiche d&apos;une commande remise au client ; il s&apos;examine et se décide sur sa propre fiche.
      </p>
      <form method="get" className="mb-4 flex flex-wrap items-end gap-3">
        <div className="flex flex-col gap-1">
          <label htmlFor="filtre-statut-retour" className="text-sm font-medium">
            Statut
          </label>
          <select id="filtre-statut-retour" name="statut" defaultValue={status ?? ""} className="rounded-lg border border-line px-3 py-2">
            <option value="">À traiter (à vérifier, en vérification, à rembourser)</option>
            {Object.entries(RETURN_STATUS_LABELS).map(([value, label]) => (
              <option key={value} value={value}>
                {label}
              </option>
            ))}
          </select>
        </div>
        <div className="flex flex-col gap-1">
          <label htmlFor="filtre-delai-retour" className="text-sm font-medium">
            Délai de déclaration
          </label>
          <select id="filtre-delai-retour" name="delai" defaultValue={late ? "hors" : ""} className="rounded-lg border border-line px-3 py-2">
            <option value="">Tous</option>
            <option value="hors">Hors délai seulement</option>
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
                    <Link href={`/admin/retours/${row.id}`} className="font-medium text-brand-blue underline-offset-2 hover:underline">
                      {row.number}
                    </Link>
                    <div className="text-xs text-ink-muted">{formatDateTime(row.createdAt)}</div>
                    {row.lateDeclaration && <span className="mt-1 inline-block rounded-md bg-amber-100 px-2 py-0.5 text-xs font-semibold text-amber-900">Hors délai</span>}
                  </td>
                  <td className="px-3 py-2">
                    <Link href={`/admin/commandes/${row.orderId}`} className="font-medium text-brand-blue underline-offset-2 hover:underline">
                      {row.orderNumber}
                    </Link>
                    <div className="text-xs text-ink-muted">{row.customerName}</div>
                  </td>
                  <td className="px-3 py-2">
                    {RETURN_STATUS_LABELS[row.status]}
                    {row.processingOverdue && <div className="text-xs font-semibold text-red-800">Traitement en retard</div>}
                    {row.refundAmount > 0 && <div className="text-xs text-ink-muted">Remboursement {formatFcfa(row.refundAmount)}</div>}
                  </td>
                  <td className="whitespace-nowrap px-3 py-2 text-right">{formatFcfa(row.itemsValue)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      <Pagination basePath="/admin/retours" params={{ statut: status, delai: late ? "hors" : undefined }} page={page} pageCount={pageCount} />
    </>
  );
}
