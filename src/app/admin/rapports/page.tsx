import type { Metadata } from "next";
import Link from "next/link";
import { PageHeader, Section, stringParam } from "@/components/admin/admin-ui";
import { businessDateKey, formatDate, formatDateTime } from "@/lib/dates";
import { formatFcfa } from "@/lib/money";
import { requirePermission } from "@/server/auth/session";
import { db } from "@/server/db/client";
import { getFinancialReport, REPORT_ENTRY_LIMIT } from "@/server/modules/reports/financial";
import { MAX_REPORT_DAYS, parseReportPeriod } from "@/server/modules/reports/period";

export const metadata: Metadata = { title: "Rapports financiers", robots: { index: false } };

type SearchParams = Promise<Record<string, string | string[] | undefined>>;

function Totals({ rows }: { rows: [string, number, boolean?][] }) {
  return (
    <dl className="grid gap-x-6 gap-y-1 text-sm sm:grid-cols-[16rem_1fr]">
      {rows.map(([label, value, strong]) => (
        <div key={label} className="contents">
          <dt className="text-ink-muted">{label}</dt>
          <dd className={strong ? "font-semibold" : undefined}>{formatFcfa(value)}</dd>
        </div>
      ))}
    </dl>
  );
}

const cell = "px-3 py-2";
const amountCell = "whitespace-nowrap px-3 py-2 text-right";

/** Rapport financier d'une période et ses exports (CSV, Excel, PDF). */
export default async function ReportsPage({ searchParams }: { searchParams: SearchParams }) {
  // Rapport financier : reports.read ET payments.read (un gestionnaire de stock n'y a pas accès).
  await requirePermission("reports.read", "/admin/rapports");
  const user = await requirePermission("payments.read", "/admin/rapports");
  const params = await searchParams;
  const today = businessDateKey();
  const period = parseReportPeriod(stringParam(params.du), stringParam(params.au), today);
  const report = "error" in period ? null : await getFinancialReport(db, user, period);
  const canExport = user.permissions.has("reports.export");
  const query = report ? `du=${report.period.fromKey}&au=${report.period.toKey}` : "";

  return (
    <div className="flex flex-col gap-6">
      <PageHeader title="Rapports financiers" />
      <form method="get" className="-mt-2 flex flex-wrap items-end gap-3">
        <div className="flex flex-col gap-1">
          <label htmlFor="rapport-du" className="text-sm font-medium">
            Du
          </label>
          <input id="rapport-du" name="du" type="date" max={today} defaultValue={report?.period.fromKey ?? stringParam(params.du)} className="rounded-lg border border-line px-3 py-2" />
        </div>
        <div className="flex flex-col gap-1">
          <label htmlFor="rapport-au" className="text-sm font-medium">
            Au
          </label>
          <input id="rapport-au" name="au" type="date" max={today} defaultValue={report?.period.toKey ?? stringParam(params.au)} className="rounded-lg border border-line px-3 py-2" />
        </div>
        <button type="submit" className="rounded-lg border border-line px-4 py-2 text-sm font-semibold hover:bg-surface-muted">
          Afficher
        </button>
      </form>
      <p className="-mt-4 text-xs text-ink-muted">Bornes incluses, {MAX_REPORT_DAYS} jours au plus. Montants TTC, en espèces uniquement.</p>

      {"error" in period ? (
        <p role="alert" className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-800">
          {period.error}
        </p>
      ) : (
        report && (
          <>
            {canExport && (
              <div className="flex flex-wrap gap-2" aria-label="Exports">
                {(["csv", "xlsx", "pdf"] as const).map((format) => (
                  <a key={format} href={`/admin/rapports/export?format=${format}&${query}`} className="rounded-lg border border-line bg-surface px-4 py-2 text-sm font-semibold hover:bg-surface-muted" download>
                    Exporter en {format === "csv" ? "CSV" : format === "xlsx" ? "Excel" : "PDF"}
                  </a>
                ))}
              </div>
            )}

            <div className="grid gap-4 lg:grid-cols-2">
              <Section title={`Caisse du ${formatDate(report.period.from)} au ${formatDate(new Date(report.period.to.getTime() - 1))}`}>
                <Totals
                  rows={[
                    ["Encaissé", report.cash.received],
                    ["Annulé (contre-écritures)", report.cash.voided],
                    ["Remboursé (retours)", report.cash.refunded],
                    ["Net en caisse (espèces)", report.cash.net, true],
                    ["Dont commandes", report.byDocument.orders],
                    ["Dont interventions", report.byDocument.interventions],
                  ]}
                />
              </Section>
              <Section title="Ventes et prestations">
                <Totals
                  rows={[
                    [`Commandes remises au client (${report.sales.count}, ${report.sales.itemsSold} article(s))`, report.sales.total, true],
                    ["Dont frais de livraison", report.sales.deliveryFees],
                    [`Interventions facturées (${report.invoicedInterventions.count})`, report.invoicedInterventions.total, true],
                  ]}
                />
              </Section>
            </div>

            <Section title="Par agent">
              {report.byCashier.length === 0 ? (
                <p className="text-sm text-ink-muted">Aucune écriture sur la période.</p>
              ) : (
                <div className="overflow-x-auto">
                  <table className="w-full text-left text-sm">
                    <thead className="text-xs uppercase text-ink-muted">
                      <tr>
                        <th scope="col" className={cell}>Agent</th>
                        <th scope="col" className={amountCell}>Encaissé</th>
                        <th scope="col" className={amountCell}>Annulé</th>
                        <th scope="col" className={amountCell}>Remboursé</th>
                        <th scope="col" className={amountCell}>Net</th>
                      </tr>
                    </thead>
                    <tbody>
                      {report.byCashier.map((row) => (
                        <tr key={row.name} className="border-t border-line">
                          <td className={cell}>
                            {row.name} <span className="text-xs text-ink-muted">({row.count})</span>
                          </td>
                          <td className={amountCell}>{formatFcfa(row.received)}</td>
                          <td className={amountCell}>{formatFcfa(row.voided)}</td>
                          <td className={amountCell}>{formatFcfa(row.refunded)}</td>
                          <td className={`${amountCell} font-semibold`}>{formatFcfa(row.net)}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </Section>

            <Section title="Par jour">
              {report.byDay.length === 0 ? (
                <p className="text-sm text-ink-muted">Aucune écriture sur la période.</p>
              ) : (
                <ul className="grid gap-1 text-sm sm:grid-cols-2">
                  {report.byDay.map((row) => (
                    <li key={row.day} className="flex justify-between gap-2 border-b border-line py-1">
                      <Link href={`/admin/encaissements?jour=${row.day}`} className="text-brand-blue underline-offset-2 hover:underline">
                        {row.day}
                      </Link>
                      <span className="font-semibold">{formatFcfa(row.net)}</span>
                    </li>
                  ))}
                </ul>
              )}
            </Section>

            {report.refunds.length > 0 && (
              <Section title="Remboursements">
                <ul className="flex flex-col gap-1 text-sm">
                  {report.refunds.map((row) => (
                    <li key={row.receiptNumber}>
                      {formatDateTime(row.createdAt)} — {row.receiptNumber} · retour {row.returnNumber} · {row.orderNumber} · {row.recordedBy} :{" "}
                      <strong>{formatFcfa(row.amount)}</strong>
                    </li>
                  ))}
                </ul>
              </Section>
            )}

            {report.invoicedInterventions.rows.length > 0 && (
              <Section title="Interventions facturées">
                <ul className="flex flex-col gap-1 text-sm">
                  {report.invoicedInterventions.rows.map((row) => (
                    <li key={row.invoiceNumber}>
                      {formatDateTime(row.issuedAt)} — {row.invoiceNumber} · {row.interventionNumber} · {row.customerName} : <strong>{formatFcfa(row.total)}</strong>
                    </li>
                  ))}
                </ul>
              </Section>
            )}
            {report.truncated && <p className="text-sm text-amber-800">Plus de {REPORT_ENTRY_LIMIT} écritures : le détail exporté est limité, les totaux couvrent toute la période.</p>}
          </>
        )
      )}
    </div>
  );
}
