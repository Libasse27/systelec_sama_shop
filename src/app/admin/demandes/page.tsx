import type { Metadata } from "next";
import Link from "next/link";
import type { QuoteRequestStatus } from "@/generated/prisma/client";
import { PageHeader, Pagination, pageParam, stringParam } from "@/components/admin/admin-ui";
import { formatDateTime } from "@/lib/dates";
import { QUOTE_REQUEST_STATUS_LABELS, URGENCY_LABELS } from "@/lib/labels";
import { requirePermission } from "@/server/auth/session";
import { db } from "@/server/db/client";
import { listAdminRequests } from "@/server/modules/quotes/queries";

export const metadata: Metadata = { title: "Demandes de devis", robots: { index: false } };

type SearchParams = Promise<Record<string, string | string[] | undefined>>;

const parseStatus = (value: string | undefined) =>
  Object.keys(QUOTE_REQUEST_STATUS_LABELS).find((status) => status === value) as QuoteRequestStatus | undefined;

export default async function AdminRequestsPage({ searchParams }: { searchParams: SearchParams }) {
  const user = await requirePermission("quotes.read", "/admin/demandes");
  const params = await searchParams;
  const q = stringParam(params.q);
  const status = parseStatus(stringParam(params.statut));
  const { rows, total, page, pageCount } = await listAdminRequests(db, user, { q, status, page: pageParam(params.page) });

  return (
    <>
      <PageHeader title="Demandes de devis" />
      <form method="get" role="search" className="mb-4 flex flex-wrap items-end gap-3">
        <div className="flex min-w-48 flex-1 flex-col gap-1">
          <label htmlFor="recherche-demandes" className="text-sm font-medium">
            Rechercher
          </label>
          <input id="recherche-demandes" name="q" type="search" defaultValue={q} placeholder="Numéro, nom ou téléphone" className="rounded-lg border border-line px-3 py-2" />
        </div>
        <div className="flex flex-col gap-1">
          <label htmlFor="filtre-statut-demande" className="text-sm font-medium">
            Statut
          </label>
          <select id="filtre-statut-demande" name="statut" defaultValue={status ?? ""} className="rounded-lg border border-line px-3 py-2">
            <option value="">Tous</option>
            {Object.entries(QUOTE_REQUEST_STATUS_LABELS).map(([value, label]) => (
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
      <p className="mb-2 text-sm text-ink-muted">{total} demande(s), urgentes en premier</p>
      {rows.length === 0 ? (
        <p className="rounded-xl border border-line bg-surface p-6 text-center text-ink-muted">Aucune demande.</p>
      ) : (
        <ul className="divide-y divide-line rounded-xl border border-line bg-surface">
          {rows.map((row) => (
            <li key={row.id} className="flex flex-wrap items-center justify-between gap-2 p-3 text-sm">
              <div>
                <Link href={`/admin/demandes/${row.id}`} className="font-medium text-brand-blue underline-offset-2 hover:underline">
                  {row.number}
                </Link>
                {row.urgency === "URGENT" && <span className="ml-2 rounded bg-red-100 px-1.5 py-0.5 text-xs font-semibold text-red-900">{URGENCY_LABELS.URGENT}</span>}
                <div className="text-xs text-ink-muted">
                  {formatDateTime(row.createdAt)}
                  {row.serviceName && ` · ${row.serviceName}`}
                </div>
              </div>
              <div className="text-right">
                {row.customerName}
                <div className="text-xs text-ink-muted">
                  {row.customerPhone} · {QUOTE_REQUEST_STATUS_LABELS[row.status]}
                </div>
              </div>
            </li>
          ))}
        </ul>
      )}
      <Pagination basePath="/admin/demandes" params={{ q, statut: status }} page={page} pageCount={pageCount} />
    </>
  );
}
