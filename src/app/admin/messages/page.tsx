import type { Metadata } from "next";
import Link from "next/link";
import type { ContactMessageStatus } from "@/generated/prisma/client";
import { PageHeader, Pagination, pageParam, stringParam } from "@/components/admin/admin-ui";
import { formatDateTime } from "@/lib/dates";
import { CONTACT_MESSAGE_STATUS_LABELS, CONTACT_SUBJECT_LABELS } from "@/lib/labels";
import { requirePermission } from "@/server/auth/session";
import { db } from "@/server/db/client";
import { listContactMessages } from "@/server/modules/contact/queries";

export const metadata: Metadata = { title: "Messages", robots: { index: false } };

type SearchParams = Promise<Record<string, string | string[] | undefined>>;

const parseStatus = (value: string | undefined) =>
  Object.keys(CONTACT_MESSAGE_STATUS_LABELS).find((status) => status === value) as ContactMessageStatus | undefined;

export default async function AdminMessagesPage({ searchParams }: { searchParams: SearchParams }) {
  const user = await requirePermission("messages.manage", "/admin/messages");
  const params = await searchParams;
  const q = stringParam(params.q);
  const status = parseStatus(stringParam(params.statut));
  const { rows, total, page, pageCount } = await listContactMessages(db, user, { q, status, page: pageParam(params.page) });

  return (
    <>
      <PageHeader title="Messages" />
      <form method="get" role="search" className="mb-4 flex flex-wrap items-end gap-3">
        <div className="flex min-w-48 flex-1 flex-col gap-1">
          <label htmlFor="recherche-messages" className="text-sm font-medium">
            Rechercher
          </label>
          <input id="recherche-messages" name="q" type="search" defaultValue={q} placeholder="Numéro, nom, e-mail ou téléphone" className="rounded-lg border border-line px-3 py-2" />
        </div>
        <div className="flex flex-col gap-1">
          <label htmlFor="filtre-statut-message" className="text-sm font-medium">
            Statut
          </label>
          <select id="filtre-statut-message" name="statut" defaultValue={status ?? ""} className="rounded-lg border border-line px-3 py-2">
            <option value="">Tous</option>
            {Object.entries(CONTACT_MESSAGE_STATUS_LABELS).map(([value, label]) => (
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
      <p className="mb-2 text-sm text-ink-muted">{total} message(s), nouveaux en premier</p>
      {rows.length === 0 ? (
        <p className="rounded-xl border border-line bg-surface p-6 text-center text-ink-muted">Aucun message.</p>
      ) : (
        <ul className="divide-y divide-line rounded-xl border border-line bg-surface">
          {rows.map((row) => (
            <li key={row.id} className="flex flex-wrap items-center justify-between gap-2 p-3 text-sm">
              <div>
                <Link href={`/admin/messages/${row.id}`} className="font-medium text-brand-blue underline-offset-2 hover:underline">
                  {row.number}
                </Link>
                {row.status === "NEW" && <span className="ml-2 rounded bg-amber-100 px-1.5 py-0.5 text-xs font-semibold text-amber-900">{CONTACT_MESSAGE_STATUS_LABELS.NEW}</span>}
                <div className="text-xs text-ink-muted">
                  {formatDateTime(row.createdAt)} · {CONTACT_SUBJECT_LABELS[row.subject]}
                </div>
              </div>
              <div className="text-right">
                {row.name}
                <div className="text-xs text-ink-muted">
                  {[row.email, row.phone].filter(Boolean).join(" · ")} · {CONTACT_MESSAGE_STATUS_LABELS[row.status]}
                </div>
              </div>
            </li>
          ))}
        </ul>
      )}
      <Pagination basePath="/admin/messages" params={{ q, statut: status }} page={page} pageCount={pageCount} />
    </>
  );
}
