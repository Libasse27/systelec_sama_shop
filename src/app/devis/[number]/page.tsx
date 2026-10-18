import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { ActionForm, SubmitButton, TextField } from "@/components/forms/form-controls";
import { InterventionFollowUp } from "@/components/services/intervention-follow-up";
import { formatDate } from "@/lib/dates";
import { QUOTE_ITEM_KIND_LABELS, QUOTE_STATUS_LABELS } from "@/lib/labels";
import { formatFcfa } from "@/lib/money";
import { getCurrentUser } from "@/server/auth/session";
import { db } from "@/server/db/client";
import { getQuoteForViewer } from "@/server/modules/quotes/queries";
import { decideQuoteAction } from "../actions";

export const metadata: Metadata = { title: "Devis", robots: { index: false }, referrer: "no-referrer" };

type Props = { params: Promise<{ number: string }>; searchParams: Promise<Record<string, string | string[] | undefined>> };

/** Devis envoyé : détail, réponse du client, puis suivi de l'intervention, reçus et facture. */
export default async function QuotePage({ params, searchParams }: Props) {
  const { number } = await params;
  const query = await searchParams;
  const token = typeof query.jeton === "string" ? query.jeton : undefined;
  const user = await getCurrentUser();
  const accountQuote = user ? await getQuoteForViewer(db, { userId: user.id }, number) : null;
  const quote = accountQuote ?? (token ? await getQuoteForViewer(db, { userId: null, token }, number) : null);
  if (!quote) notFound();
  // Invité : reçus et facture s'ouvrent avec le même jeton que ce lien.
  const guestToken = accountQuote ? null : (token ?? null);
  const documentQuery = guestToken ? `?jeton=${encodeURIComponent(guestToken)}` : "";

  return (
    <main className="mx-auto max-w-3xl px-4 py-8">
      <h1 className="text-2xl font-bold">Devis {quote.number}</h1>
      {query.reponse === "acceptee" && quote.status === "ACCEPTED" && (
        <p role="status" className="mt-4 rounded-lg border border-green-200 bg-green-50 p-3 text-green-900">
          Merci, devis accepté ! Nous vous appelons pour fixer la date de l&apos;intervention.
        </p>
      )}
      {query.reponse === "refusee" && quote.status === "REFUSED" && (
        <p role="status" className="mt-4 rounded-lg border border-line bg-surface p-3">
          Votre refus est enregistré. N&apos;hésitez pas à nous recontacter.
        </p>
      )}

      <dl className="mt-6 grid gap-x-6 gap-y-2 rounded-xl border border-line bg-surface p-4 text-sm sm:grid-cols-[12rem_1fr]">
        <dt className="text-ink-muted">Statut</dt>
        <dd className="font-semibold">{QUOTE_STATUS_LABELS[quote.status]}</dd>
        <dt className="text-ink-muted">Valable jusqu&apos;au</dt>
        <dd>{formatDate(quote.validUntil)}</dd>
        {quote.request && (
          <>
            <dt className="text-ink-muted">Lieu</dt>
            <dd>{quote.request.address}</dd>
          </>
        )}
      </dl>

      <div className="mt-4 overflow-x-auto rounded-xl border border-line bg-surface">
        <table className="w-full text-left text-sm">
          <thead className="bg-surface-muted text-xs uppercase text-ink-muted">
            <tr>
              <th scope="col" className="px-3 py-2">Désignation</th>
              <th scope="col" className="px-3 py-2 text-right">Prix</th>
              <th scope="col" className="px-3 py-2 text-right">Qté</th>
              <th scope="col" className="px-3 py-2 text-right">Total</th>
            </tr>
          </thead>
          <tbody>
            {quote.items.map((item, index) => (
              <tr key={`${index}-${item.label}`} className="border-t border-line">
                <td className="px-3 py-2">
                  {item.label}
                  <div className="text-xs text-ink-muted">{QUOTE_ITEM_KIND_LABELS[item.kind]}</div>
                </td>
                <td className="whitespace-nowrap px-3 py-2 text-right">{formatFcfa(item.unitPrice)}</td>
                <td className="px-3 py-2 text-right">{item.quantity}</td>
                <td className="whitespace-nowrap px-3 py-2 text-right">{formatFcfa(item.lineTotal)}</td>
              </tr>
            ))}
          </tbody>
          <tfoot className="border-t border-line">
            <tr className="font-bold">
              <td colSpan={3} className="px-3 py-2 text-right">Total TTC, à régler en espèces après la prestation</td>
              <td className="whitespace-nowrap px-3 py-2 text-right">{formatFcfa(quote.total)}</td>
            </tr>
          </tfoot>
        </table>
      </div>
      {quote.notes && <p className="mt-3 whitespace-pre-line text-sm">{quote.notes}</p>}

      {quote.canDecide && (
        <ActionForm action={decideQuoteAction.bind(null, quote.id, quote.number, guestToken)} className="mt-6 rounded-xl border border-line bg-surface p-4">
          <TextField name="note" label="Message (facultatif)" required={false} />
          <div className="flex flex-wrap gap-2">
            <SubmitButton name="decision" value="accept" confirm="Accepter ce devis ? Nous vous appellerons pour fixer la date.">
              Accepter le devis
            </SubmitButton>
            <SubmitButton name="decision" value="refuse" variant="secondary" confirm="Refuser ce devis ?">
              Refuser
            </SubmitButton>
          </div>
        </ActionForm>
      )}

      {quote.intervention && <InterventionFollowUp intervention={quote.intervention} documentQuery={documentQuery} />}
    </main>
  );
}
