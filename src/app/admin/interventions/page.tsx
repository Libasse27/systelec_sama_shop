import type { Metadata } from "next";
import Link from "next/link";
import { PageHeader, Pagination, pageParam, stringParam } from "@/components/admin/admin-ui";
import { formatDateTime } from "@/lib/dates";
import { INTERVENTION_STATUS_LABELS, PAYMENT_STATUS_LABELS } from "@/lib/labels";
import { formatFcfa } from "@/lib/money";
import { requireAnyPermission } from "@/server/auth/session";
import { db } from "@/server/db/client";
import { listAdminInterventions, parseInterventionStatus } from "@/server/modules/interventions/queries";

export const metadata: Metadata = { title: "Interventions", robots: { index: false } };

type SearchParams = Promise<Record<string, string | string[] | undefined>>;

/** Toutes les interventions (responsables), ou celles du technicien connecté. */
export default async function AdminInterventionsPage({ searchParams }: { searchParams: SearchParams }) {
  const user = await requireAnyPermission(["interventions.read", "interventions.manage", "interventions.update_own"], "/admin/interventions");
  const params = await searchParams;
  const status = parseInterventionStatus(stringParam(params.statut));
  const { rows, total, page, pageCount } = await listAdminInterventions(db, user, { status, page: pageParam(params.page) });
  const ownOnly = !user.permissions.has("interventions.read") && !user.permissions.has("interventions.manage");

  return (
    <>
      <PageHeader title={ownOnly ? "Mes interventions" : "Interventions"} />
      <form method="get" className="mb-4 flex flex-wrap items-end gap-3">
        <div className="flex flex-col gap-1">
          <label htmlFor="filtre-statut-intervention" className="text-sm font-medium">
            Statut
          </label>
          <select id="filtre-statut-intervention" name="statut" defaultValue={status ?? ""} className="rounded-lg border border-line px-3 py-2">
            <option value="">Tous</option>
            {Object.entries(INTERVENTION_STATUS_LABELS).map(([value, label]) => (
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
      <p className="mb-2 text-sm text-ink-muted">{total} intervention(s)</p>
      {rows.length === 0 ? (
        <p className="rounded-xl border border-line bg-surface p-6 text-center text-ink-muted">Aucune intervention.</p>
      ) : (
        <ul className="divide-y divide-line rounded-xl border border-line bg-surface">
          {rows.map((row) => (
            <li key={row.id} className="flex flex-wrap items-center justify-between gap-2 p-3 text-sm">
              <div>
                <Link href={`/admin/interventions/${row.id}`} className="font-medium text-brand-blue underline-offset-2 hover:underline">
                  {row.number}
                </Link>
                <div className="text-xs text-ink-muted">
                  {row.customerName} · {row.address}
                </div>
              </div>
              <div className="text-right">
                {INTERVENTION_STATUS_LABELS[row.status]}
                {row.nextAppointment && row.status === "SCHEDULED" && ` · ${formatDateTime(row.nextAppointment)}`}
                <div className="text-xs text-ink-muted">
                  {row.technician ?? "Sans technicien"} · {formatFcfa(row.amountDue)} · {PAYMENT_STATUS_LABELS[row.paymentStatus]}
                </div>
              </div>
            </li>
          ))}
        </ul>
      )}
      <Pagination basePath="/admin/interventions" params={{ statut: status }} page={page} pageCount={pageCount} />
    </>
  );
}
