import { randomUUID } from "node:crypto";
import { Section } from "@/components/admin/admin-ui";
import { ActionForm, IntegerField, SubmitButton, TextField } from "@/components/forms/form-controls";
import { formatDateTime } from "@/lib/dates";
import { PAYMENT_STATUS_LABELS } from "@/lib/labels";
import { formatFcfa } from "@/lib/money";
import type { CurrentUser } from "@/server/auth/session";
import { db } from "@/server/db/client";
import type { AdminOrder } from "@/server/modules/orders/queries";
import { PAYABLE_ORDER_STATUSES } from "@/server/modules/payments/balance";
import { listOrderPayments } from "@/server/modules/payments/queries";
import { getSetting } from "@/server/modules/settings/service";
import { recordPaymentAction, voidPaymentAction } from "../actions";

/** Solde, encaissement en espèces et contre-écritures d'une commande (selon les permissions). */
export async function PaymentsSection({ order, user }: { order: AdminOrder; user: CurrentUser }) {
  const canRecord = user.permissions.has("payments.record");
  const canCorrect = user.permissions.has("payments.correct");
  if (!canRecord && !user.permissions.has("payments.read")) return null;
  const [payments, commerce] = await Promise.all([listOrderPayments(db, user, order.id), getSetting("commerce", db)]);
  const balance = order.total - order.amountPaid;

  return (
    <Section title="Encaissements">
      <dl className="grid gap-x-6 gap-y-1 text-sm sm:grid-cols-[12rem_1fr]">
        <dt className="text-ink-muted">Statut du paiement</dt>
        <dd className="font-semibold">{PAYMENT_STATUS_LABELS[order.paymentStatus]}</dd>
        <dt className="text-ink-muted">Total</dt>
        <dd>{formatFcfa(order.total)}</dd>
        <dt className="text-ink-muted">Encaissé</dt>
        <dd>{formatFcfa(order.amountPaid)}</dd>
        <dt className="text-ink-muted">Reste à payer</dt>
        <dd className="font-semibold">{formatFcfa(balance)}</dd>
      </dl>

      {canRecord && PAYABLE_ORDER_STATUSES.includes(order.status) && (
        // Formulaire toujours monté : le message de confirmation reste visible une fois la commande soldée.
        <ActionForm action={recordPaymentAction.bind(null, order.id)} className="mt-4 border-t border-line pt-4">
          {balance > 0 ? (
            <>
              <input type="hidden" name="idempotencyKey" value={randomUUID()} />
              <div className="grid gap-3 sm:grid-cols-2">
                <IntegerField
                  name="amount"
                  label="Montant reçu en espèces (FCFA)"
                  defaultValue={String(balance)}
                  hint={commerce.partialPaymentEnabled ? "Acompte possible, jamais au-delà du reste à payer." : "Paiement partiel désactivé : solde complet uniquement."}
                />
                <TextField name="note" label="Note interne" required={false} hint="Jamais imprimée sur le reçu." />
              </div>
              <div>
                <SubmitButton confirm="Confirmer la réception de ces espèces ? L'encaissement ne pourra être corrigé que par contre-écriture.">
                  Enregistrer l&apos;encaissement
                </SubmitButton>
              </div>
            </>
          ) : (
            <p className="text-sm text-green-800">Commande soldée.</p>
          )}
        </ActionForm>
      )}
      {order.status === "PENDING_CONFIRMATION" && canRecord && <p className="mt-4 text-sm text-ink-muted">Confirmez la commande avant d&apos;encaisser.</p>}

      {payments.length > 0 && (
        <ul className="mt-4 flex flex-col gap-3 border-t border-line pt-4 text-sm">
          {payments.map((payment) => (
            <li key={payment.id} className="flex flex-col gap-2">
              <div>
                <a href={`/recus/${payment.receiptNumber}`} target="_blank" rel="noopener" className="font-medium text-brand-blue underline">
                  {payment.receiptNumber}
                </a>{" "}
                — {formatDateTime(payment.createdAt)} · {payment.amount > 0 ? "encaissement" : "contre-écriture"}{" "}
                <span className={payment.amount < 0 ? "text-red-800" : undefined}>{formatFcfa(payment.amount)}</span> · {payment.recordedBy}
                {payment.reverses && <span className="text-ink-muted"> · annule {payment.reverses} ({payment.reason})</span>}
                {payment.reversedBy && <span className="text-red-800"> · annulé par {payment.reversedBy}</span>}
                {payment.note && <div className="text-xs text-ink-muted">Note : {payment.note}</div>}
              </div>
              {canCorrect && payment.amount > 0 && order.status !== "CLOSED" && (
                <ActionForm action={voidPaymentAction.bind(null, order.id, payment.id)}>
                  {!payment.reversedBy && (
                    <div className="flex flex-wrap items-end gap-2">
                      <TextField name="reason" label={`Motif d'annulation de ${payment.receiptNumber}`} hint="Imprimé sur le reçu d'annulation." className="min-w-56 flex-1" />
                      <SubmitButton variant="danger" confirm="Annuler cet encaissement par contre-écriture ? Les espèces doivent être rendues ou l'erreur avérée.">
                        Annuler l&apos;encaissement
                      </SubmitButton>
                    </div>
                  )}
                </ActionForm>
              )}
            </li>
          ))}
        </ul>
      )}
    </Section>
  );
}
