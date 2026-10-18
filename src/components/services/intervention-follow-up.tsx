import { formatDateTime, formatTime } from "@/lib/dates";
import { INTERVENTION_STATUS_LABELS, PAYMENT_STATUS_LABELS } from "@/lib/labels";
import { formatFcfa } from "@/lib/money";
import type { CustomerIntervention } from "@/server/modules/quotes/queries";

/** Suivi client d'une intervention : statut, rendez-vous, paiement, facture et reçus (lien avec jeton pour un invité). */
export function InterventionFollowUp({ intervention, documentQuery }: { intervention: CustomerIntervention; documentQuery: string }) {
  const balance = intervention.amountDue - intervention.amountPaid;
  return (
    <section aria-labelledby="intervention" className="mt-6 rounded-xl border border-line bg-surface p-4">
      <h2 id="intervention" className="font-semibold">
        Intervention {intervention.number}
      </h2>
      <dl className="mt-2 grid gap-x-6 gap-y-1 text-sm sm:grid-cols-[12rem_1fr]">
        <dt className="text-ink-muted">Statut</dt>
        <dd className="font-semibold">{INTERVENTION_STATUS_LABELS[intervention.status]}</dd>
        {intervention.appointment && intervention.status !== "CANCELLED" && (
          <>
            <dt className="text-ink-muted">Rendez-vous</dt>
            <dd>
              {formatDateTime(intervention.appointment.startsAt)} – {formatTime(intervention.appointment.endsAt)} · {intervention.appointment.technician}
            </dd>
          </>
        )}
        <dt className="text-ink-muted">Paiement</dt>
        <dd>
          {PAYMENT_STATUS_LABELS[intervention.paymentStatus]}
          {balance > 0 && ` — reste ${formatFcfa(balance)} en espèces après la prestation`}
        </dd>
      </dl>
      {(intervention.receipts.length > 0 || intervention.invoiceNumber) && (
        <ul className="mt-3 flex flex-col gap-1 text-sm">
          {intervention.invoiceNumber && (
            <li>
              <a href={`/factures/${intervention.invoiceNumber}${documentQuery}`} target="_blank" rel="noopener" className="text-brand-blue underline">
                Facture {intervention.invoiceNumber} (PDF)
              </a>
            </li>
          )}
          {intervention.receipts.map((receipt) => (
            <li key={receipt.receiptNumber}>
              <a href={`/recus/${receipt.receiptNumber}${documentQuery}`} target="_blank" rel="noopener" className="text-brand-blue underline">
                Reçu {receipt.receiptNumber} (PDF)
              </a>{" "}
              — {formatDateTime(receipt.createdAt)} · {receipt.amount > 0 ? `${formatFcfa(receipt.amount)} reçus` : `annulation de ${formatFcfa(-receipt.amount)}`}
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
