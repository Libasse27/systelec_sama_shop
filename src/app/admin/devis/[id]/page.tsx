import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { PageHeader, Section } from "@/components/admin/admin-ui";
import { ActionForm, SubmitButton, TextAreaField, TextField } from "@/components/forms/form-controls";
import { businessDateKey, formatDate, formatDateTime } from "@/lib/dates";
import { QUOTE_ITEM_KIND_LABELS, QUOTE_STATUS_LABELS } from "@/lib/labels";
import { formatFcfa } from "@/lib/money";
import { requirePermission } from "@/server/auth/session";
import { db } from "@/server/db/client";
import { getAdminQuote, type AdminQuote } from "@/server/modules/quotes/queries";
import { MAX_QUOTE_LINES } from "@/server/modules/quotes/schemas";
import { decideQuoteForCustomerAction, saveQuoteAction } from "../actions";

export const metadata: Metadata = { title: "Devis", robots: { index: false } };

/** Lignes vides proposées en plus des lignes existantes. */
const BLANK_ROWS = 5;
const cellClass = "w-full rounded-lg border border-line bg-surface px-2 py-1.5 text-sm";

type Props = { params: Promise<{ id: string }>; searchParams: Promise<Record<string, string | string[] | undefined>> };

export default async function AdminQuotePage({ params, searchParams }: Props) {
  const { id } = await params;
  const justSent = (await searchParams).envoye === "1";
  const user = await requirePermission("quotes.read", `/admin/devis/${id}`);
  const quote = await getAdminQuote(db, user, id);
  if (!quote) notFound();
  const canManage = user.permissions.has("quotes.manage");

  return (
    <div className="flex flex-col gap-6">
      <PageHeader title={`Devis ${quote.number}`} />
      <p className="-mt-4 text-sm text-ink-muted">
        {QUOTE_STATUS_LABELS[quote.status]}
        {quote.quoteRequest && (
          <>
            {" · "}
            <Link href={`/admin/demandes/${quote.quoteRequest.id}`} className="text-brand-blue underline">
              demande {quote.quoteRequest.number}
            </Link>{" "}
            de {quote.quoteRequest.contact.name} ({quote.quoteRequest.contact.phone})
          </>
        )}
        {quote.intervention && (
          <>
            {" · "}
            <Link href={`/admin/interventions/${quote.intervention.id}`} className="text-brand-blue underline">
              intervention {quote.intervention.number}
            </Link>
          </>
        )}
      </p>

      {justSent && quote.status !== "DRAFT" && (
        <p role="status" className="-mt-2 rounded-lg border border-green-200 bg-green-50 p-3 text-green-900">
          Devis envoyé au client ({formatFcfa(quote.total)}).
        </p>
      )}
      {quote.status === "DRAFT" && canManage ? <DraftEditor quote={quote} /> : <QuoteSummary quote={quote} />}

      {canManage && quote.status !== "DRAFT" && (
        <Section title="Réponse du client">
          {/* Toujours monté : le message de confirmation reste visible après la décision. */}
          <ActionForm action={decideQuoteForCustomerAction.bind(null, quote.id)}>
            {quote.status === "SENT" ? (
              <>
                <TextField name="note" label="Précision" required={false} hint="Par exemple : accord donné par téléphone le…" />
                <div className="flex flex-wrap gap-2">
                  <SubmitButton name="decision" value="accept" confirm="Enregistrer l'acceptation du client ? Une intervention sera créée.">
                    Le client accepte
                  </SubmitButton>
                  <SubmitButton name="decision" value="refuse" variant="secondary" confirm="Enregistrer le refus du client ?">
                    Le client refuse
                  </SubmitButton>
                </div>
              </>
            ) : (
              <p className="text-sm text-ink-muted">
                {quote.decidedAt ? `Décision du ${formatDateTime(quote.decidedAt)}` : "Plus de réponse attendue"}
                {quote.decisionNote && ` : ${quote.decisionNote}`}
              </p>
            )}
          </ActionForm>
        </Section>
      )}
    </div>
  );
}

function DraftEditor({ quote }: { quote: AdminQuote }) {
  const rows = [...quote.items, ...Array.from({ length: BLANK_ROWS }, () => null)].slice(0, MAX_QUOTE_LINES);
  return (
    <Section title="Lignes du devis">
      <ActionForm action={saveQuoteAction.bind(null, quote.id)}>
        <input type="hidden" name="rows" value={rows.length} />
        <div className="overflow-x-auto">
          <table className="w-full min-w-[40rem] text-left text-sm">
            <thead className="text-xs uppercase text-ink-muted">
              <tr>
                <th scope="col" className="py-1 pr-2">Type</th>
                <th scope="col" className="py-1 pr-2">Désignation</th>
                <th scope="col" className="w-24 py-1 pr-2">Quantité</th>
                <th scope="col" className="w-36 py-1">Prix unitaire (FCFA)</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((item, index) => (
                <tr key={index}>
                  <td className="py-1 pr-2">
                    <select name={`items.${index}.kind`} defaultValue={item?.kind ?? "MATERIAL"} aria-label={`Type, ligne ${index + 1}`} className={cellClass}>
                      {Object.entries(QUOTE_ITEM_KIND_LABELS).map(([value, label]) => (
                        <option key={value} value={value}>
                          {label}
                        </option>
                      ))}
                    </select>
                  </td>
                  <td className="py-1 pr-2">
                    <input name={`items.${index}.label`} defaultValue={item?.label ?? ""} aria-label={`Désignation, ligne ${index + 1}`} className={cellClass} />
                  </td>
                  <td className="py-1 pr-2">
                    <input name={`items.${index}.quantity`} inputMode="numeric" defaultValue={item?.quantity ?? ""} aria-label={`Quantité, ligne ${index + 1}`} className={cellClass} />
                  </td>
                  <td className="py-1">
                    <input name={`items.${index}.unitPrice`} inputMode="numeric" defaultValue={item?.unitPrice ?? ""} aria-label={`Prix unitaire, ligne ${index + 1}`} className={cellClass} />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <p className="text-xs text-ink-muted">Lignes vides ignorées. Enregistrez pour obtenir de nouvelles lignes vides. Total actuel : {formatFcfa(quote.total)}.</p>
        <div className="grid gap-4 sm:grid-cols-[12rem_1fr]">
          <TextField name="validUntil" label="Valable jusqu'au" type="date" defaultValue={businessDateKey(quote.validUntil)} />
          <TextAreaField name="notes" label="Conditions et remarques" required={false} rows={2} defaultValue={quote.notes} hint="Imprimées sur le devis du client." />
        </div>
        <div className="flex flex-wrap gap-2">
          <SubmitButton name="intent" value="save" variant="secondary">
            Enregistrer le brouillon
          </SubmitButton>
          <SubmitButton name="intent" value="send" confirm="Envoyer ce devis au client ? Il ne pourra plus être modifié.">
            Enregistrer et envoyer au client
          </SubmitButton>
        </div>
      </ActionForm>
    </Section>
  );
}

function QuoteSummary({ quote }: { quote: AdminQuote }) {
  return (
    <Section title="Contenu du devis">
      <ul className="flex flex-col gap-1 text-sm">
        {quote.items.map((item, index) => (
          <li key={`${index}-${item.label}`} className="flex justify-between gap-4">
            <span>
              {QUOTE_ITEM_KIND_LABELS[item.kind]} — {item.label} : {item.quantity} × {formatFcfa(item.unitPrice)}
            </span>
            <span className="whitespace-nowrap">{formatFcfa(item.lineTotal)}</span>
          </li>
        ))}
      </ul>
      <p className="mt-3 font-semibold">Total : {formatFcfa(quote.total)}</p>
      <p className="text-sm text-ink-muted">
        Valable jusqu&apos;au {formatDate(quote.validUntil)}
        {quote.sentAt && ` · envoyé le ${formatDateTime(quote.sentAt)}`}
      </p>
      {quote.notes && <p className="mt-2 whitespace-pre-line text-sm">{quote.notes}</p>}
    </Section>
  );
}
