import type { Metadata } from "next";
import Link from "next/link";
import { PageHeader, Pagination, pageParam, stringParam } from "@/components/admin/admin-ui";
import { formatDateTime } from "@/lib/dates";
import { FULFILLMENT_LABELS, ORDER_STATUS_LABELS, PAYMENT_STATUS_LABELS } from "@/lib/labels";
import { formatFcfa } from "@/lib/money";
import { requirePermission } from "@/server/auth/session";
import { db } from "@/server/db/client";
import { listAdminOrders, parseOrderStatus, parsePaymentStatus } from "@/server/modules/orders/queries";

export const metadata: Metadata = { title: "Commandes", robots: { index: false } };

type SearchParams = Promise<Record<string, string | string[] | undefined>>;

export default async function AdminOrdersPage({ searchParams }: { searchParams: SearchParams }) {
  const user = await requirePermission("orders.read", "/admin/commandes");
  const params = await searchParams;
  const q = stringParam(params.q);
  const status = parseOrderStatus(stringParam(params.statut));
  const paymentStatus = parsePaymentStatus(stringParam(params.paiement));
  const { rows, total, page, pageCount } = await listAdminOrders(db, user, { q, status, paymentStatus, page: pageParam(params.page) });

  return (
    <>
      <PageHeader title="Commandes" />
      <form method="get" role="search" className="mb-4 flex flex-wrap items-end gap-3">
        <div className="flex min-w-48 flex-1 flex-col gap-1">
          <label htmlFor="recherche-commandes" className="text-sm font-medium">
            Rechercher
          </label>
          <input id="recherche-commandes" name="q" type="search" defaultValue={q} placeholder="Numéro, nom ou téléphone" className="rounded-lg border border-line px-3 py-2" />
        </div>
        <div className="flex flex-col gap-1">
          <label htmlFor="filtre-statut-commande" className="text-sm font-medium">
            Statut
          </label>
          <select id="filtre-statut-commande" name="statut" defaultValue={status ?? ""} className="rounded-lg border border-line px-3 py-2">
            <option value="">Tous</option>
            {Object.entries(ORDER_STATUS_LABELS).map(([value, label]) => (
              <option key={value} value={value}>
                {label}
              </option>
            ))}
          </select>
        </div>
        <div className="flex flex-col gap-1">
          <label htmlFor="filtre-paiement-commande" className="text-sm font-medium">
            Paiement
          </label>
          <select id="filtre-paiement-commande" name="paiement" defaultValue={paymentStatus ?? ""} className="rounded-lg border border-line px-3 py-2">
            <option value="">Tous</option>
            {(["UNPAID", "PARTIALLY_PAID", "PAID"] as const).map((value) => (
              <option key={value} value={value}>
                {PAYMENT_STATUS_LABELS[value]}
              </option>
            ))}
          </select>
        </div>
        <button type="submit" className="rounded-lg border border-line px-4 py-2 text-sm font-semibold hover:bg-surface-muted">
          Filtrer
        </button>
      </form>
      <p className="mb-2 text-sm text-ink-muted">{total} commande(s)</p>
      {rows.length === 0 ? (
        <p className="rounded-xl border border-line bg-surface p-6 text-center text-ink-muted">Aucune commande.</p>
      ) : (
        <div className="overflow-x-auto rounded-xl border border-line bg-surface">
          <table className="w-full text-left text-sm">
            <thead className="bg-surface-muted text-xs uppercase text-ink-muted">
              <tr>
                <th scope="col" className="px-3 py-2">Commande</th>
                <th scope="col" className="px-3 py-2">Client</th>
                <th scope="col" className="px-3 py-2">Statut</th>
                <th scope="col" className="px-3 py-2 text-right">Total</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((row) => (
                <tr key={row.id} className="border-t border-line">
                  <td className="px-3 py-2">
                    <Link href={`/admin/commandes/${row.id}`} className="font-medium text-brand-blue underline-offset-2 hover:underline">
                      {row.number}
                    </Link>
                    <div className="text-xs text-ink-muted">
                      {formatDateTime(row.createdAt)} · {FULFILLMENT_LABELS[row.fulfillmentMethod]}
                    </div>
                  </td>
                  <td className="px-3 py-2">
                    {row.customerName}
                    <div className="text-xs text-ink-muted">{row.customerPhone}</div>
                  </td>
                  <td className="px-3 py-2">
                    {ORDER_STATUS_LABELS[row.status]}
                    <div className="text-xs text-ink-muted">{PAYMENT_STATUS_LABELS[row.paymentStatus]}</div>
                    {row.reservedUntil && <div className="text-xs text-amber-800">Réservé jusqu&apos;au {formatDateTime(row.reservedUntil)}</div>}
                  </td>
                  <td className="whitespace-nowrap px-3 py-2 text-right">{formatFcfa(row.total)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      <Pagination basePath="/admin/commandes" params={{ q, statut: status, paiement: paymentStatus }} page={page} pageCount={pageCount} />
    </>
  );
}
