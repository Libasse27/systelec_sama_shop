import { randomUUID } from "node:crypto";
import { Section } from "@/components/admin/admin-ui";
import { ActionForm, CheckboxField, IntegerField, SubmitButton, TextAreaField, TextField } from "@/components/forms/form-controls";
import type { OrderStatus } from "@/generated/prisma/client";
import { formatDateTime } from "@/lib/dates";
import { RETURN_STATUS_LABELS } from "@/lib/labels";
import { formatFcfa } from "@/lib/money";
import type { CurrentUser } from "@/server/auth/session";
import { db } from "@/server/db/client";
import { getOrderReturns, type ReturnView } from "@/server/modules/returns/queries";
import { createReturnAction, decideReturnAction, refundReturnAction } from "../actions";

interface ReturnsSectionProps {
  orderId: string;
  orderStatus: OrderStatus;
  user: CurrentUser;
}

function ReturnCard({ orderId, entry, user }: { orderId: string; entry: ReturnView; user: CurrentUser }) {
  const canDecide = user.permissions.has("orders.update");
  const canRefund = user.permissions.has("payments.correct");
  return (
    <li className="flex flex-col gap-3 rounded-lg border border-line p-3">
      <div className="text-sm">
        <span className="font-semibold">{entry.number}</span> — {RETURN_STATUS_LABELS[entry.status]} · enregistré le {formatDateTime(entry.createdAt)}
        {entry.createdBy && ` par ${entry.createdBy}`}
        <div className="text-ink-muted">Motif : {entry.reason}</div>
        <ul className="mt-1">
          {entry.items.map((item) => (
            <li key={item.sku}>
              {item.quantity} × {item.productName} — {item.variantName} ({formatFcfa(item.unitPrice)})
            </li>
          ))}
        </ul>
        <div>Valeur : {formatFcfa(entry.itemsValue)}</div>
        {entry.decidedAt && (
          <div className="mt-1">
            Décision du {formatDateTime(entry.decidedAt)}
            {entry.decidedBy && ` (${entry.decidedBy})`} : {entry.decisionNote}
            {entry.restocked !== null && ` · ${entry.restocked ? "remis en stock" : "non remis en stock"}`}
            {entry.status !== "REJECTED" && ` · remboursement ${formatFcfa(entry.refundAmount)}`}
          </div>
        )}
        {entry.refundReceipt && (
          <div>
            Remboursé :{" "}
            <a href={`/recus/${entry.refundReceipt}`} target="_blank" rel="noopener" className="text-brand-blue underline">
              reçu {entry.refundReceipt}
            </a>
          </div>
        )}
      </div>

      {/* Formulaires toujours montés : leur message de confirmation reste visible après la décision. */}
      {canDecide && (
        <ActionForm action={decideReturnAction.bind(null, orderId, entry.id)}>
          {entry.status === "RECEIVED" && (
            <>
          <div className="grid gap-3 sm:grid-cols-2">
            <IntegerField
              name="refundAmount"
              label="Montant à rembourser (FCFA)"
              defaultValue={entry.maxRefund}
              hint={`Au plus ${formatFcfa(entry.maxRefund)} (remise de la commande déduite, frais de livraison non compris). 0 : aucun remboursement.`}
            />
            <TextField name="note" label="Motif de la décision" hint="État des articles, remise en stock ou non." />
          </div>
          <CheckboxField name="restock" label="Remettre les articles en stock (intacts et revendables)" defaultChecked />
          <div className="flex flex-wrap gap-2">
            <SubmitButton name="decision" value="ACCEPT" confirm="Accepter ce retour ? La décision est définitive.">
              Accepter le retour
            </SubmitButton>
            <SubmitButton name="decision" value="REJECT" variant="danger" confirm="Refuser ce retour ? Les articles sont rendus au client.">
              Refuser
            </SubmitButton>
          </div>
            </>
          )}
        </ActionForm>
      )}

      {canRefund && entry.refundAmount > 0 && (
        <ActionForm action={refundReturnAction.bind(null, orderId, entry.id)}>
          {entry.status === "REFUND_PENDING" ? (
            <div className="flex flex-wrap items-end gap-2">
              <input type="hidden" name="idempotencyKey" value={randomUUID()} />
              <TextField name="note" label="Note interne" required={false} className="min-w-56 flex-1" />
              <SubmitButton confirm={`Rembourser ${formatFcfa(entry.refundAmount)} en espèces au client ?`}>Rembourser {formatFcfa(entry.refundAmount)} en espèces</SubmitButton>
            </div>
          ) : null}
        </ActionForm>
      )}
    </li>
  );
}

/** Retours d'une commande remise au client : enregistrement, décision motivée, remboursement en espèces. */
export async function ReturnsSection({ orderId, orderStatus, user }: ReturnsSectionProps) {
  const { returns, returnable } = await getOrderReturns(db, user, orderId);
  const canCreate = user.permissions.has("orders.update") && orderStatus === "CLOSED";
  const remaining = returnable.filter((line) => line.remaining > 0);
  if (returns.length === 0 && !canCreate) return null;

  return (
    <Section title="Retours">
      {returns.length > 0 && (
        <ul className="flex flex-col gap-3">
          {returns.map((entry) => (
            <ReturnCard key={entry.id} orderId={orderId} entry={entry} user={user} />
          ))}
        </ul>
      )}
      {canCreate && (
        <div className="mt-4 border-t border-line pt-4">
          <h3 className="mb-3 font-semibold">Enregistrer un retour</h3>
          <ActionForm action={createReturnAction.bind(null, orderId)} resetOnSuccess>
            {remaining.length === 0 ? (
              <p className="text-sm text-ink-muted">Tous les articles livrés font déjà l&apos;objet d&apos;un retour.</p>
            ) : (
              <>
            <input type="hidden" name="idempotencyKey" value={randomUUID()} />
            <div className="grid gap-3 sm:grid-cols-2">
              {remaining.map((line) => (
                  <IntegerField
                    key={line.orderItemId}
                    name={`qte-${line.orderItemId}`}
                    label={`Quantité retournée : ${line.productName} — ${line.variantName}`}
                    required={false}
                    hint={`${line.remaining} au plus (${formatFcfa(line.unitPrice)} l'unité)`}
                  />
                ))}
            </div>
            <TextAreaField name="reason" label="Motif du client" rows={2} />
            <div>
              <SubmitButton>Enregistrer le retour</SubmitButton>
            </div>
              </>
            )}
          </ActionForm>
        </div>
      )}
    </Section>
  );
}
