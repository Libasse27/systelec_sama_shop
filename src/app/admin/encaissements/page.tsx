import type { Metadata } from "next";
import Link from "next/link";
import { PageHeader, Section, stringParam } from "@/components/admin/admin-ui";
import { businessDateKey, businessDayRange, formatDate, formatDateTime } from "@/lib/dates";
import { formatFcfa } from "@/lib/money";
import { requirePermission } from "@/server/auth/session";
import { db } from "@/server/db/client";
import { getPaymentJournal, JOURNAL_LIMIT } from "@/server/modules/payments/queries";

export const metadata: Metadata = { title: "Encaissements", robots: { index: false } };

type SearchParams = Promise<Record<string, string | string[] | undefined>>;

/** Journal de caisse d'une journée : encaissements, contre-écritures, net à remettre par agent. */
export default async function PaymentJournalPage({ searchParams }: { searchParams: SearchParams }) {
  const user = await requirePermission("payments.read", "/admin/encaissements");
  const requested = stringParam((await searchParams).jour);
  const today = businessDateKey();
  const day = requested && businessDayRange(requested) ? requested : today;
  const range = businessDayRange(day)!;
  const journal = await getPaymentJournal(db, user, range);

  return (
    <div className="flex flex-col gap-6">
      <PageHeader title="Encaissements" />
      <form method="get" className="-mt-2 flex flex-wrap items-end gap-3">
        <div className="flex flex-col gap-1">
          <label htmlFor="jour-caisse" className="text-sm font-medium">
            Journée
          </label>
          <input id="jour-caisse" name="jour" type="date" defaultValue={day} max={today} className="rounded-lg border border-line px-3 py-2" />
        </div>
        <button type="submit" className="rounded-lg border border-line px-4 py-2 text-sm font-semibold hover:bg-surface-muted">
          Afficher
        </button>
      </form>

      <Section title={`Caisse du ${formatDate(range.from)}`}>
        <dl className="grid gap-x-6 gap-y-1 text-sm sm:grid-cols-[14rem_1fr]">
          <dt className="text-ink-muted">Encaissé en espèces</dt>
          <dd>{formatFcfa(journal.totals.received)}</dd>
          <dt className="text-ink-muted">Annulé (contre-écritures)</dt>
          <dd>{formatFcfa(journal.totals.voided)}</dd>
          <dt className="text-ink-muted">Net de la journée</dt>
          <dd className="font-semibold">{formatFcfa(journal.totals.net)}</dd>
        </dl>
        {journal.byRecorder.length > 0 && (
          <>
            <h3 className="mt-4 text-sm font-semibold">Net à remettre par agent</h3>
            <ul className="mt-1 flex flex-col gap-1 text-sm">
              {journal.byRecorder.map((row) => (
                <li key={row.name}>
                  {row.name} : <span className="font-semibold">{formatFcfa(row.net)}</span> ({row.count} écriture(s))
                </li>
              ))}
            </ul>
          </>
        )}
      </Section>

      {journal.rows.length === 0 ? (
        <p className="rounded-xl border border-line bg-surface p-6 text-center text-ink-muted">Aucun encaissement ce jour-là.</p>
      ) : (
        <div className="overflow-x-auto rounded-xl border border-line bg-surface">
          <table className="w-full text-left text-sm">
            <thead className="bg-surface-muted text-xs uppercase text-ink-muted">
              <tr>
                <th scope="col" className="px-3 py-2">Reçu</th>
                <th scope="col" className="px-3 py-2">Commande</th>
                <th scope="col" className="px-3 py-2">Agent</th>
                <th scope="col" className="px-3 py-2 text-right">Montant</th>
              </tr>
            </thead>
            <tbody>
              {journal.rows.map((row) => (
                <tr key={row.id} className="border-t border-line">
                  <td className="px-3 py-2">
                    <a href={`/recus/${row.receiptNumber}`} target="_blank" rel="noopener" className="font-medium text-brand-blue underline">
                      {row.receiptNumber}
                    </a>
                    <div className="text-xs text-ink-muted">
                      {formatDateTime(row.createdAt)}
                      {row.reverses && ` · annule ${row.reverses}`}
                      {row.reversedBy && ` · annulé par ${row.reversedBy}`}
                    </div>
                  </td>
                  <td className="px-3 py-2">
                    <Link href={`/admin/commandes/${row.orderId}`} className="text-brand-blue underline-offset-2 hover:underline">
                      {row.orderNumber}
                    </Link>
                  </td>
                  <td className="px-3 py-2">{row.recordedBy}</td>
                  <td className={`whitespace-nowrap px-3 py-2 text-right ${row.amount < 0 ? "text-red-800" : ""}`}>{formatFcfa(row.amount)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      {journal.truncated && <p className="text-sm text-amber-800">Seules les {JOURNAL_LIMIT} dernières écritures sont listées ; les totaux couvrent toute la journée.</p>}
    </div>
  );
}
