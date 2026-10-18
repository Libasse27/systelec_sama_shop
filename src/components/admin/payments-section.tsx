import { randomUUID } from "node:crypto";
import { Section } from "@/components/admin/admin-ui";
import { ActionForm, IntegerField, SubmitButton, TextField } from "@/components/forms/form-controls";
import { formatDateTime } from "@/lib/dates";
import { PAYMENT_STATUS_LABELS } from "@/lib/labels";
import { formatFcfa } from "@/lib/money";
import type { CurrentUser } from "@/server/auth/session";
import { db } from "@/server/db/client";
import type { PaymentStatus } from "@/generated/prisma/client";
import { listPayments } from "@/server/modules/payments/queries";
import type { PaymentTarget } from "@/server/modules/payments/targets";
import { getSetting } from "@/server/modules/settings/service";
import { recordPaymentAction, voidPaymentAction } from "@/app/admin/_lib/payment-actions";

export interface PaymentsSectionProps {
  target: PaymentTarget;
  total: number;
  /** Net des remboursements. */
  amountPaid: number;
  /** Remboursé suite à des retours (commandes). */
  refundedAmount?: number;
  paymentStatus: PaymentStatus;
  /** Encaissement possible dans l'état actuel du document ; sinon le motif affiché. */
  payable: true | string;
  /** Contre-écriture possible dans l'état actuel du document. */
  voidable: boolean;
  user: CurrentUser;
}

/** Solde, encaissement en espèces et contre-écritures d'une commande ou d'une intervention (selon les permissions). */
export async function PaymentsSection({ target, total, amountPaid, refundedAmount = 0, paymentStatus, payable, voidable, user }: PaymentsSectionProps) {
  const canRecord = user.permissions.has("payments.record");
  const canCorrect = user.permissions.has("payments.correct");
  if (!canRecord && !user.permissions.has("payments.read")) return null;
  const [payments, commerce] = await Promise.all([listPayments(db, user, target), getSetting("commerce", db)]);
  const balance = total - amountPaid - refundedAmount;

  return (
    <Section title="Encaissements">
      <dl className="grid gap-x-6 gap-y-1 text-sm sm:grid-cols-[12rem_1fr]">
        <dt className="text-ink-muted">Statut du paiement</dt>
        <dd className="font-semibold">{PAYMENT_STATUS_LABELS[paymentStatus]}</dd>
        <dt className="text-ink-muted">Total</dt>
        <dd>{formatFcfa(total)}</dd>
        <dt className="text-ink-muted">Encaissé</dt>
        <dd>{formatFcfa(amountPaid + refundedAmount)}</dd>
        {refundedAmount > 0 && (
          <>
            <dt className="text-ink-muted">Remboursé (retours)</dt>
            <dd>{formatFcfa(refundedAmount)}</dd>
          </>
        )}
        <dt className="text-ink-muted">Reste à payer</dt>
        <dd className="font-semibold">{formatFcfa(balance)}</dd>
      </dl>

      {canRecord && payable === true && (
        // Formulaire toujours monté : le message de confirmation reste visible une fois la commande soldée.
        <ActionForm action={recordPaymentAction.bind(null, target)} className="mt-4 border-t border-line pt-4">
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
            <p className="text-sm text-green-800">Soldé : il ne reste rien à encaisser.</p>
          )}
        </ActionForm>
      )}
      {canRecord && payable !== true && balance > 0 && <p className="mt-4 text-sm text-ink-muted">{payable}</p>}

      {payments.length > 0 && (
        <ul className="mt-4 flex flex-col gap-3 border-t border-line pt-4 text-sm">
          {payments.map((payment) => (
            <li key={payment.id} className="flex flex-col gap-2">
              <div>
                <a href={`/recus/${payment.receiptNumber}`} target="_blank" rel="noopener" className="font-medium text-brand-blue underline">
                  {payment.receiptNumber}
                </a>{" "}
                — {formatDateTime(payment.createdAt)} · {payment.amount > 0 ? "encaissement" : payment.refundOf ? `remboursement du retour ${payment.refundOf}` : "contre-écriture"}{" "}
                <span className={payment.amount < 0 ? "text-red-800" : undefined}>{formatFcfa(payment.amount)}</span> · {payment.recordedBy}
                {payment.reverses && <span className="text-ink-muted"> · annule {payment.reverses} ({payment.reason})</span>}
                {payment.reversedBy && <span className="text-red-800"> · annulé par {payment.reversedBy}</span>}
                {payment.note && <div className="text-xs text-ink-muted">Note : {payment.note}</div>}
              </div>
              {canCorrect && payment.amount > 0 && voidable && (
                <ActionForm action={voidPaymentAction.bind(null, target, payment.id)}>
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
