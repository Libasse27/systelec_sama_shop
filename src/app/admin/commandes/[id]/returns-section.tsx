import Link from "next/link";
import { randomUUID } from "node:crypto";
import { Section } from "@/components/admin/admin-ui";
import { ActionForm, IntegerField, SubmitButton, TextAreaField } from "@/components/forms/form-controls";
import type { OrderStatus } from "@/generated/prisma/client";
import { formatDateTime } from "@/lib/dates";
import { RETURN_STATUS_LABELS } from "@/lib/labels";
import { formatFcfa } from "@/lib/money";
import type { CurrentUser } from "@/server/auth/session";
import { db } from "@/server/db/client";
import { RETURN_DECLARATION_HOURS } from "@/server/modules/returns/policy";
import { getOrderReturns } from "@/server/modules/returns/queries";
import { createReturnAction } from "../actions";

interface ReturnsSectionProps {
  orderId: string;
  orderStatus: OrderStatus;
  user: CurrentUser;
}

/**
 * Retours d'une commande remise au client : déclaration au nom du client (le client ne déclare pas
 * lui-même en ligne). L'examen, la décision et le remboursement se font sur la fiche du retour.
 */
export async function ReturnsSection({ orderId, orderStatus, user }: ReturnsSectionProps) {
  const { returns, returnable } = await getOrderReturns(db, user, orderId);
  const canCreate = user.permissions.has("orders.update") && orderStatus === "CLOSED";
  const remaining = returnable.filter((line) => line.remaining > 0);
  if (returns.length === 0 && !canCreate) return null;

  return (
    <Section title="Retours">
      {returns.length > 0 && (
        <ul className="flex flex-col gap-2">
          {returns.map((entry) => (
            <li key={entry.id} className="flex flex-wrap items-center gap-x-3 gap-y-1 rounded-lg border border-line p-3 text-sm">
              <Link href={`/admin/retours/${entry.id}`} className="font-semibold text-brand-blue underline">
                {entry.number}
              </Link>
              <span>{RETURN_STATUS_LABELS[entry.status]}</span>
              {entry.lateDeclaration && <span className="rounded-md bg-amber-100 px-2 py-0.5 text-xs font-semibold text-amber-900">Hors délai</span>}
              {entry.processingOverdue && <span className="rounded-md bg-red-100 px-2 py-0.5 text-xs font-semibold text-red-900">Traitement en retard</span>}
              <span className="text-ink-muted">
                déclaré le {formatDateTime(entry.createdAt)} · {formatFcfa(entry.itemsValue)}
                {entry.refundReceipt && ` · remboursé (reçu ${entry.refundReceipt})`}
              </span>
            </li>
          ))}
        </ul>
      )}
      {canCreate && (
        <div className="mt-4 border-t border-line pt-4">
          <h3 className="mb-1 font-semibold">Déclarer un retour (au nom du client)</h3>
          <p className="mb-3 text-sm text-ink-muted">
            Produit endommagé, défectueux ou non conforme : à déclarer dans les {RETURN_DECLARATION_HOURS} h suivant la remise. Au-delà, le retour est enregistré et
            marqué « hors délai ». Un autre responsable le décidera.
          </p>
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
