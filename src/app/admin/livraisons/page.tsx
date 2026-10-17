import type { Metadata } from "next";
import Link from "next/link";
import { PageHeader, Pagination, pageParam, stringParam } from "@/components/admin/admin-ui";
import { formatDate, formatDateTime } from "@/lib/dates";
import { DELIVERY_STATUS_LABELS, ORDER_STATUS_LABELS } from "@/lib/labels";
import { requirePermission } from "@/server/auth/session";
import { db } from "@/server/db/client";
import { listCouriers, listDeliveries, parseDeliveryStatus } from "@/server/modules/deliveries/queries";

export const metadata: Metadata = { title: "Livraisons", robots: { index: false } };

type SearchParams = Promise<Record<string, string | string[] | undefined>>;

/** Livraisons à faire (ou filtrées), avec le livreur et l'adresse ; le suivi se fait depuis la commande. */
export default async function DeliveriesPage({ searchParams }: { searchParams: SearchParams }) {
  const user = await requirePermission("deliveries.manage", "/admin/livraisons");
  const params = await searchParams;
  const status = parseDeliveryStatus(stringParam(params.statut));
  const couriers = await listCouriers(db, user);
  const courierParam = stringParam(params.livreur);
  const courierId = couriers.some((courier) => courier.id === courierParam) ? courierParam : undefined;
  const { rows, total, page, pageCount } = await listDeliveries(db, user, { status, courierId, page: pageParam(params.page) });

  return (
    <>
      <PageHeader title="Livraisons">
        <Link href="/admin/livraison" className="text-sm text-brand-blue underline">
          Zones, points de retrait et livreurs
        </Link>
      </PageHeader>
      <form method="get" className="mb-4 flex flex-wrap items-end gap-3">
        <div className="flex flex-col gap-1">
          <label htmlFor="filtre-statut-livraison" className="text-sm font-medium">
            Statut
          </label>
          <select id="filtre-statut-livraison" name="statut" defaultValue={status ?? ""} className="rounded-lg border border-line px-3 py-2">
            <option value="">À faire (assignées, en cours, en échec)</option>
            {Object.entries(DELIVERY_STATUS_LABELS).map(([value, label]) => (
              <option key={value} value={value}>
                {label}
              </option>
            ))}
          </select>
        </div>
        <div className="flex flex-col gap-1">
          <label htmlFor="filtre-livreur" className="text-sm font-medium">
            Livreur
          </label>
          <select id="filtre-livreur" name="livreur" defaultValue={courierId ?? ""} className="rounded-lg border border-line px-3 py-2">
            <option value="">Tous</option>
            {couriers.map((courier) => (
              <option key={courier.id} value={courier.id}>
                {courier.name}
              </option>
            ))}
          </select>
        </div>
        <button type="submit" className="rounded-lg border border-line px-4 py-2 text-sm font-semibold hover:bg-surface-muted">
          Filtrer
        </button>
      </form>
      <p className="mb-2 text-sm text-ink-muted">{total} livraison(s)</p>
      {rows.length === 0 ? (
        <p className="rounded-xl border border-line bg-surface p-6 text-center text-ink-muted">Aucune livraison.</p>
      ) : (
        <div className="overflow-x-auto rounded-xl border border-line bg-surface">
          <table className="w-full text-left text-sm">
            <thead className="bg-surface-muted text-xs uppercase text-ink-muted">
              <tr>
                <th scope="col" className="px-3 py-2">Commande</th>
                <th scope="col" className="px-3 py-2">Client et adresse</th>
                <th scope="col" className="px-3 py-2">Livraison</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((row) => (
                <tr key={row.orderId} className="border-t border-line align-top">
                  <td className="px-3 py-2">
                    <Link href={`/admin/commandes/${row.orderId}`} className="font-medium text-brand-blue underline-offset-2 hover:underline">
                      {row.orderNumber}
                    </Link>
                    <div className="text-xs text-ink-muted">{ORDER_STATUS_LABELS[row.orderStatus]}</div>
                  </td>
                  <td className="px-3 py-2">
                    {row.customerName} · {row.customerPhone}
                    <div className="text-xs text-ink-muted">{row.address}</div>
                  </td>
                  <td className="px-3 py-2">
                    <span className="font-medium">{DELIVERY_STATUS_LABELS[row.status]}</span> · {row.courierName}
                    <div className="text-xs text-ink-muted">
                      {row.scheduledFor && `Prévue le ${formatDate(row.scheduledFor)} · `}
                      {row.attempts} tentative(s) · mise à jour {formatDateTime(row.updatedAt)}
                    </div>
                    {row.status === "FAILED" && row.failureReason && <div className="text-xs text-red-800">Échec : {row.failureReason}</div>}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      <Pagination basePath="/admin/livraisons" params={{ statut: status, livreur: courierId }} page={page} pageCount={pageCount} />
    </>
  );
}
