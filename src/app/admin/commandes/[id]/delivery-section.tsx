import { Section } from "@/components/admin/admin-ui";
import { ActionForm, SelectField, SubmitButton, TextField } from "@/components/forms/form-controls";
import type { OrderStatus } from "@/generated/prisma/client";
import { businessDateKey, formatDate, formatDateTime } from "@/lib/dates";
import { DELIVERY_STATUS_LABELS } from "@/lib/labels";
import type { CurrentUser } from "@/server/auth/session";
import { db } from "@/server/db/client";
import { getOrderDelivery, listCouriers } from "@/server/modules/deliveries/queries";
import { assignCourierAction, completeDeliveryAction, failDeliveryAction, startDeliveryAction } from "../actions";

interface DeliverySectionProps {
  orderId: string;
  orderStatus: OrderStatus;
  user: CurrentUser;
}

/** Livraison à domicile : livreur, départ, preuve de livraison ou échec motivé. */
export async function DeliverySection({ orderId, orderStatus, user }: DeliverySectionProps) {
  const canManage = user.permissions.has("deliveries.manage");
  const [delivery, couriers] = await Promise.all([getOrderDelivery(db, user, orderId), canManage ? listCouriers(db, user) : Promise.resolve([])]);
  const activeCouriers = couriers.filter((courier) => courier.isActive);
  const status = delivery?.status ?? null;
  const assignable = canManage && ["CONFIRMED", "PREPARING", "READY_TO_SHIP"].includes(orderStatus) && status !== "IN_TRANSIT" && status !== "DELIVERED";

  return (
    <Section title="Livraison">
      {delivery ? (
        <dl className="grid gap-x-6 gap-y-1 text-sm sm:grid-cols-[12rem_1fr]">
          <dt className="text-ink-muted">Statut</dt>
          <dd className="font-semibold">{DELIVERY_STATUS_LABELS[delivery.status]}</dd>
          <dt className="text-ink-muted">Livreur</dt>
          <dd>
            {delivery.courier.name} · {delivery.courier.phone}
          </dd>
          {delivery.scheduledFor && (
            <>
              <dt className="text-ink-muted">Prévue le</dt>
              <dd>{formatDate(delivery.scheduledFor)}</dd>
            </>
          )}
          <dt className="text-ink-muted">Tentatives</dt>
          <dd>{delivery.attempts}</dd>
          {delivery.failureReason && delivery.status === "FAILED" && (
            <>
              <dt className="text-ink-muted">Motif de l&apos;échec</dt>
              <dd className="text-red-800">{delivery.failureReason}</dd>
            </>
          )}
          {delivery.deliveredAt && (
            <>
              <dt className="text-ink-muted">Livrée le</dt>
              <dd>
                {formatDateTime(delivery.deliveredAt)} · reçue par {delivery.recipientName}
                {delivery.proofNote && <span className="text-ink-muted"> ({delivery.proofNote})</span>}
              </dd>
            </>
          )}
        </dl>
      ) : (
        <p className="text-sm text-ink-muted">Aucun livreur assigné.</p>
      )}

      {assignable && (
        <ActionForm action={assignCourierAction.bind(null, orderId)} className="mt-4 border-t border-line pt-4">
          {activeCouriers.length === 0 ? (
            <p className="text-sm text-ink-muted">Aucun livreur actif : ajoutez-en un dans « Livraison et retrait ».</p>
          ) : (
            <>
              <div className="grid gap-3 sm:grid-cols-3">
                <SelectField
                  name="courierId"
                  label="Livreur"
                  defaultValue={delivery?.courier.id ?? activeCouriers[0]?.id}
                  options={activeCouriers.map((courier) => ({ value: courier.id, label: `${courier.name} (${courier.activeDeliveries} en cours)` }))}
                />
                <TextField name="scheduledFor" label="Date prévue" type="date" required={false} defaultValue={delivery?.scheduledFor ? businessDateKey(delivery.scheduledFor) : undefined} />
                <TextField name="note" label="Consigne" required={false} />
              </div>
              <div>
                <SubmitButton variant="secondary">{delivery ? "Réassigner" : "Assigner le livreur"}</SubmitButton>
              </div>
            </>
          )}
        </ActionForm>
      )}

      {/* Formulaires montés dès qu'une livraison existe : leur message de confirmation reste visible. */}
      {canManage && status !== null && (
        <ActionForm action={startDeliveryAction.bind(null, orderId)} className="mt-4 border-t border-line pt-4">
          {(status === "ASSIGNED" || status === "FAILED") &&
            (orderStatus === "READY_TO_SHIP" ? (
              <div>
                <SubmitButton>{status === "FAILED" ? "Nouvelle tentative : départ" : "Départ en livraison"}</SubmitButton>
              </div>
            ) : (
              <p className="text-sm text-ink-muted">Le départ est possible quand la commande est « Prête à livrer ».</p>
            ))}
        </ActionForm>
      )}

      {canManage && (status === "IN_TRANSIT" || status === "DELIVERED" || status === "FAILED") && (
        <div className="mt-4 grid gap-4 border-t border-line pt-4 lg:grid-cols-2">
          <ActionForm action={completeDeliveryAction.bind(null, orderId)}>
            {status === "IN_TRANSIT" ? (
              <>
                <h3 className="text-sm font-semibold">Preuve de livraison</h3>
                <TextField name="recipientName" label="Reçue par" hint="Nom de la personne qui a reçu la commande (visible par le client)." />
                <TextField name="proofNote" label="Observations" required={false} hint="Interne : jamais montré au client." />
                <div>
                  <SubmitButton confirm="Confirmer la livraison ? La commande sera remise au client et le stock sortira définitivement.">Marquer livrée</SubmitButton>
                </div>
              </>
            ) : (
              status === "DELIVERED" && <p className="text-sm text-green-800">Livraison effectuée.</p>
            )}
          </ActionForm>
          <ActionForm action={failDeliveryAction.bind(null, orderId)}>
            {status === "IN_TRANSIT" && (
              <>
                <h3 className="text-sm font-semibold">Échec</h3>
                <TextField name="reason" label="Motif de l'échec" hint="Visible par le client (suivi et message). Ex. : client absent, adresse introuvable." />
                <div>
                  <SubmitButton variant="danger">Enregistrer l&apos;échec</SubmitButton>
                </div>
              </>
            )}
          </ActionForm>
        </div>
      )}
    </Section>
  );
}
