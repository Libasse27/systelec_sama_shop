"use client";

import { useActionState, useTransition } from "react";
import { FormMessages, useHydrated } from "@/components/admin/form-controls";
import { formatFcfa } from "@/lib/money";
import type { ImportField } from "@/server/modules/catalog/csv-import-plan";
import { importCatalogAction, type ImportState } from "./actions";

const FIELD_LABELS: Record<ImportField, string> = {
  price: "Prix",
  compareAtPrice: "Prix barré",
  costPrice: "Prix d'achat",
  alertThreshold: "Seuil d'alerte",
  counted: "Stock (inventaire)",
};
const MONEY_FIELDS = new Set<ImportField>(["price", "compareAtPrice", "costPrice"]);

const formatValue = (field: ImportField, value: number | null) =>
  value === null ? "—" : MONEY_FIELDS.has(field) ? formatFcfa(value) : String(value);

/** Import en deux temps : aperçu des changements, puis application (même fichier). */
export function ImportForm() {
  const [state, action] = useActionState<ImportState, FormData>(importCatalogAction, {});
  const [pending, startTransition] = useTransition();
  const hydrated = useHydrated();
  const plan = state.plan;

  function handleSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const submitter = (event.nativeEvent as SubmitEvent).submitter;
    if (submitter?.getAttribute("value") === "apply" && !window.confirm("Appliquer l'import ? Les prix et stocks seront modifiés.")) return;
    const formData = new FormData(event.currentTarget, submitter);
    startTransition(() => action(formData));
  }

  return (
    <div className="flex flex-col gap-4">
      <form onSubmit={handleSubmit} className="flex flex-col gap-4" aria-busy={pending}>
        <FormMessages state={state} />
        <div className="flex flex-col gap-1">
          <label htmlFor="fichier-import" className="text-sm font-medium">
            Fichier CSV
          </label>
          <input id="fichier-import" name="fichier" type="file" accept=".csv,text/csv" required className="text-sm" />
        </div>
        <div className="flex flex-wrap gap-2">
          <button type="submit" name="intent" value="preview" disabled={pending || !hydrated} className="rounded-lg border border-line px-4 py-2 text-sm font-semibold hover:bg-surface-muted disabled:opacity-60">
            Aperçu
          </button>
          <button
            type="submit"
            name="intent"
            value="apply"
            disabled={pending || !hydrated || !plan || plan.errors.length > 0 || plan.changes.length === 0}
            className="rounded-lg bg-brand-blue px-4 py-2 text-sm font-semibold text-white hover:bg-brand-blue-dark disabled:opacity-60"
          >
            Appliquer l&apos;import
          </button>
        </div>
      </form>

      {plan && plan.errors.length > 0 && (
        <div role="alert" className="rounded-lg border border-red-200 bg-red-50 p-3 text-sm text-red-900">
          <p className="font-semibold">Lignes à corriger :</p>
          <ul className="mt-2 list-disc pl-5">
            {plan.errors.map((error) => (
              <li key={`${error.line}-${error.message}`}>
                {error.line > 0 && `Ligne ${error.line} — `}
                {error.message}
              </li>
            ))}
          </ul>
        </div>
      )}

      {plan && plan.changes.length > 0 && (
        <div className="overflow-x-auto rounded-lg border border-line">
          <table className="w-full text-left text-sm">
            <caption className="p-2 text-left text-ink-muted">
              {plan.changes.length} version(s) modifiée(s), {plan.unchanged} inchangée(s)
            </caption>
            <thead className="bg-surface-muted text-xs uppercase text-ink-muted">
              <tr>
                <th scope="col" className="px-3 py-2">Ligne</th>
                <th scope="col" className="px-3 py-2">SKU</th>
                <th scope="col" className="px-3 py-2">Changements</th>
              </tr>
            </thead>
            <tbody>
              {plan.changes.map((change) => (
                <tr key={change.sku} className="border-t border-line">
                  <td className="px-3 py-2">{change.line}</td>
                  <td className="px-3 py-2 font-mono">{change.sku}</td>
                  <td className="px-3 py-2">
                    {(Object.entries(change.fields) as [ImportField, { from: number | null; to: number | null }][]).map(([field, values]) => (
                      <div key={field}>
                        {FIELD_LABELS[field]} : {formatValue(field, values.from)} → <strong>{formatValue(field, values.to)}</strong>
                      </div>
                    ))}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
