import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { PageHeader, Section } from "@/components/admin/admin-ui";
import { ActionForm, SubmitButton, TextAreaField } from "@/components/forms/form-controls";
import { OrderDetails } from "@/components/orders/order-details";
import { formatDateTime } from "@/lib/dates";
import { ORDER_STATUS_LABELS, PAYMENT_STATUS_LABELS } from "@/lib/labels";
import { requirePermission } from "@/server/auth/session";
import { db } from "@/server/db/client";
import { getAdminOrder } from "@/server/modules/orders/queries";
import { changeOrderStatusAction } from "../actions";
import { PaymentsSection } from "@/components/admin/payments-section";
import { PAYABLE_ORDER_STATUSES } from "@/server/modules/payments/balance";

export const metadata: Metadata = { title: "Commande", robots: { index: false } };

/** L'historique mêle statuts de commande et de paiement, distingués par leur champ. */
function historyLabel(field: string, status: string): string {
  if (field === "PAYMENT") return `Paiement : ${PAYMENT_STATUS_LABELS[status as keyof typeof PAYMENT_STATUS_LABELS] ?? status}`;
  return ORDER_STATUS_LABELS[status as keyof typeof ORDER_STATUS_LABELS] ?? status;
}

const NOTIFICATION_STATUS = { PENDING: "en attente", SENT: "envoyée", FAILED: "échec", SKIPPED_NO_PROVIDER: "non envoyée (aucun fournisseur)" } as const;

export default async function AdminOrderPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const user = await requirePermission("orders.read", `/admin/commandes/${id}`);
  const order = await getAdminOrder(db, user, id);
  if (!order) notFound();
  // Formulaire monté même au statut final : le message de la dernière transition reste visible.
  const canUpdate = user.permissions.has("orders.update");

  return (
    <div className="flex flex-col gap-6">
      <PageHeader title={`Commande ${order.number}`} />
      {order.reservedUntil && order.status === "PENDING_CONFIRMATION" && (
        <p className="-mt-4 text-sm text-amber-800">
          Stock réservé jusqu&apos;au {formatDateTime(order.reservedUntil)} : sans confirmation, la commande sera annulée automatiquement.
        </p>
      )}

      {canUpdate && (
        <Section title="Changer le statut">
          <ActionForm action={changeOrderStatusAction.bind(null, order.id)}>
            {order.nextStatuses.length === 0 ? (
              <p className="text-sm text-ink-muted">Statut final : plus aucun changement possible.</p>
            ) : (
              <>
                <TextAreaField name="comment" label="Commentaire" required={false} rows={2} hint="Obligatoire pour une annulation (motif). Visible par le client." />
                <div className="flex flex-wrap gap-2">
                  {order.nextStatuses.map((status) => (
                    <SubmitButton
                      key={status}
                      name="status"
                      value={status}
                      variant={status === "CANCELLED" ? "danger" : status === "CLOSED" ? "primary" : "secondary"}
                      confirm={
                        status === "CANCELLED"
                          ? "Annuler la commande ? Le stock réservé sera remis en vente."
                          : status === "CLOSED"
                            ? "Confirmer la remise au client ? Le stock sortira définitivement."
                            : undefined
                      }
                    >
                      {ORDER_STATUS_LABELS[status]}
                    </SubmitButton>
                  ))}
                </div>
              </>
            )}
          </ActionForm>
        </Section>
      )}

      <PaymentsSection
        target={{ kind: "order", id: order.id }}
        total={order.total}
        amountPaid={order.amountPaid}
        paymentStatus={order.paymentStatus}
        payable={PAYABLE_ORDER_STATUSES.includes(order.status) || (order.status === "PENDING_CONFIRMATION" ? "Confirmez la commande avant d'encaisser." : "Cette commande ne s'encaisse plus.")}
        voidable={order.status !== "CLOSED"}
        user={user}
      />

      <OrderDetails order={{ ...order, history: undefined }} receiptHref={(receipt) => `/recus/${receipt}`} />

      <Section title="Client">
        <p>
          {order.customer.name} · {order.customer.phone}
          {order.customer.email && ` · ${order.customer.email}`} · {order.customer.hasAccount ? "compte client" : "invité"}
        </p>
      </Section>

      <Section title="Historique">
        <ol className="flex flex-col gap-1 text-sm">
          {order.history.map((entry) => (
            <li key={`${entry.to}-${entry.createdAt.toISOString()}`}>
              {formatDateTime(entry.createdAt)} — {historyLabel(entry.field, entry.to)}
              {entry.actorName && ` · ${entry.actorName}`}
              {entry.comment && <span className="text-ink-muted"> ({entry.comment})</span>}
            </li>
          ))}
        </ol>
      </Section>

      <Section title="Notifications">
        {order.notifications.length === 0 ? (
          <p className="text-sm text-ink-muted">Aucune notification (ni e-mail ni téléphone exploitables).</p>
        ) : (
          <ul className="flex flex-col gap-1 text-sm">
            {order.notifications.map((notification) => (
              <li key={`${notification.channel}-${notification.template}-${notification.createdAt.toISOString()}-${notification.recipient}`}>
                {formatDateTime(notification.createdAt)} — {notification.channel} à {notification.recipient} ({notification.template}) :{" "}
                {NOTIFICATION_STATUS[notification.status as keyof typeof NOTIFICATION_STATUS] ?? notification.status}
              </li>
            ))}
          </ul>
        )}
      </Section>
    </div>
  );
}
