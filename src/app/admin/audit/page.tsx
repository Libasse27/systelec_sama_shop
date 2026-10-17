import type { Metadata } from "next";
import { PageHeader, Pagination, pageParam, stringParam } from "@/components/admin/admin-ui";
import { businessDayRange, formatDateTime } from "@/lib/dates";
import { requirePermission } from "@/server/auth/session";
import { listAuditEntityTypes, listAuditLogs, parseAuditResult } from "@/server/audit/queries";
import { db } from "@/server/db/client";

export const metadata: Metadata = { title: "Journal d'audit", robots: { index: false } };

type SearchParams = Promise<Record<string, string | string[] | undefined>>;

const RESULT_LABELS = { SUCCESS: "Réussie", FAILURE: "Échouée", DENIED: "Refusée" } as const;

/** Valeur JSON lisible et bornée (le journal ne contient aucun secret : masqué à l'écriture). */
function JsonValue({ label, value }: { label: string; value: unknown }) {
  if (value === null || value === undefined) return null;
  const text = JSON.stringify(value, null, 1);
  return (
    <div>
      <span className="font-medium">{label} :</span>
      <pre className="mt-1 max-h-48 overflow-auto whitespace-pre-wrap break-all rounded bg-surface-muted p-2 text-xs">{text.length > 4000 ? `${text.slice(0, 4000)}…` : text}</pre>
    </div>
  );
}

const field = "flex flex-col gap-1";
const input = "rounded-lg border border-line px-3 py-2";

/** Journal d'audit en lecture seule (audit.read) : filtres par acteur, action, entité, résultat et période. */
export default async function AuditPage({ searchParams }: { searchParams: SearchParams }) {
  const user = await requirePermission("audit.read", "/admin/audit");
  const params = await searchParams;
  const filters = {
    actor: stringParam(params.acteur),
    action: stringParam(params.action),
    entityType: stringParam(params.entite),
    entityId: stringParam(params.id),
    result: parseAuditResult(stringParam(params.resultat)),
    du: stringParam(params.du),
    au: stringParam(params.au),
  };
  const from = filters.du ? businessDayRange(filters.du)?.from : undefined;
  const to = filters.au ? businessDayRange(filters.au)?.to : undefined;
  const [{ rows, total, page, pageCount }, entityTypes] = await Promise.all([
    listAuditLogs(db, user, { ...filters, from, to, page: pageParam(params.page) }),
    listAuditEntityTypes(db, user),
  ]);

  return (
    <>
      <PageHeader title="Journal d'audit" />
      <p className="-mt-4 mb-4 text-sm text-ink-muted">Lecture seule : le journal ne peut être ni modifié ni effacé. Les secrets n&apos;y sont jamais enregistrés.</p>
      <form method="get" role="search" className="mb-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <div className={field}>
          <label htmlFor="audit-acteur" className="text-sm font-medium">
            Acteur
          </label>
          <input id="audit-acteur" name="acteur" type="search" defaultValue={filters.actor} placeholder="Nom, e-mail, ou « systeme »" className={input} />
        </div>
        <div className={field}>
          <label htmlFor="audit-action" className="text-sm font-medium">
            Action
          </label>
          <input id="audit-action" name="action" type="search" defaultValue={filters.action} placeholder="Ex. : payment. ou order.status" className={input} />
        </div>
        <div className={field}>
          <label htmlFor="audit-entite" className="text-sm font-medium">
            Entité
          </label>
          <select id="audit-entite" name="entite" defaultValue={filters.entityType ?? ""} className={input}>
            <option value="">Toutes</option>
            {entityTypes.map((type) => (
              <option key={type} value={type}>
                {type}
              </option>
            ))}
          </select>
        </div>
        <div className={field}>
          <label htmlFor="audit-id" className="text-sm font-medium">
            Identifiant de l&apos;entité
          </label>
          <input id="audit-id" name="id" type="search" defaultValue={filters.entityId} className={input} />
        </div>
        <div className={field}>
          <label htmlFor="audit-resultat" className="text-sm font-medium">
            Résultat
          </label>
          <select id="audit-resultat" name="resultat" defaultValue={filters.result ?? ""} className={input}>
            <option value="">Tous</option>
            {Object.entries(RESULT_LABELS).map(([value, label]) => (
              <option key={value} value={value}>
                {label}
              </option>
            ))}
          </select>
        </div>
        <div className={field}>
          <label htmlFor="audit-du" className="text-sm font-medium">
            Du
          </label>
          <input id="audit-du" name="du" type="date" defaultValue={filters.du} className={input} />
        </div>
        <div className={field}>
          <label htmlFor="audit-au" className="text-sm font-medium">
            Au
          </label>
          <input id="audit-au" name="au" type="date" defaultValue={filters.au} className={input} />
        </div>
        <div className="flex items-end">
          <button type="submit" className="rounded-lg border border-line px-4 py-2 text-sm font-semibold hover:bg-surface-muted">
            Filtrer
          </button>
        </div>
      </form>
      <p className="mb-2 text-sm text-ink-muted">{total} événement(s)</p>
      {rows.length === 0 ? (
        <p className="rounded-xl border border-line bg-surface p-6 text-center text-ink-muted">Aucun événement.</p>
      ) : (
        <ol className="flex flex-col gap-2">
          {rows.map((row) => (
            <li key={row.id} className="rounded-xl border border-line bg-surface p-3 text-sm">
              <div className="flex flex-wrap items-baseline justify-between gap-2">
                <span className="font-mono font-semibold">{row.action}</span>
                <span className={row.result === "SUCCESS" ? "text-ink-muted" : "font-semibold text-red-800"}>
                  {RESULT_LABELS[row.result]} · {formatDateTime(row.createdAt)}
                </span>
              </div>
              <div className="mt-1 break-all text-ink-muted">
                {row.actorId ? `${row.actorName ?? "Compte supprimé"}${row.actorEmail ? ` (${row.actorEmail})` : ""}` : "Système"}
                {row.entityType && ` · ${row.entityType}`}
                {row.entityId && ` ${row.entityId}`}
                {row.ip && ` · IP ${row.ip}`}
              </div>
              {(row.before !== null || row.after !== null) && (
                <details className="mt-2">
                  <summary className="cursor-pointer text-brand-blue">Détails</summary>
                  <div className="mt-2 grid gap-2 lg:grid-cols-2">
                    <JsonValue label="Avant" value={row.before} />
                    <JsonValue label="Après" value={row.after} />
                  </div>
                </details>
              )}
            </li>
          ))}
        </ol>
      )}
      <Pagination
        basePath="/admin/audit"
        params={{ acteur: filters.actor, action: filters.action, entite: filters.entityType, id: filters.entityId, resultat: filters.result, du: filters.du, au: filters.au }}
        page={page}
        pageCount={pageCount}
      />
    </>
  );
}
