import type { Metadata } from "next";
import { randomUUID } from "node:crypto";
import { PageHeader, Section } from "@/components/admin/admin-ui";
import { ActionForm, SubmitButton, TextField } from "@/components/forms/form-controls";
import { formatDateTime } from "@/lib/dates";
import { DELIVERY_STATUS_LABELS } from "@/lib/labels";
import { formatFcfa } from "@/lib/money";
import { requirePermission } from "@/server/auth/session";
import { db } from "@/server/db/client";
import { listMyDeliveries, type MyDeliveryRow } from "@/server/modules/deliveries/queries";
import { collectMyDeliveryAction, completeMyDeliveryAction, failMyDeliveryAction, startMyDeliveryAction } from "./actions";

export const metadata: Metadata = { title: "Mes livraisons", robots: { index: false } };

function DeliveryCard({ row }: { row: MyDeliveryRow }) {
  const inTransit = row.status === "IN_TRANSIT";
  const canStart = (row.status === "ASSIGNED" || row.status === "FAILED") && row.orderStatus === "READY_TO_SHIP";
  return (
    <Section title={`Commande ${row.orderNumber} · ${DELIVERY_STATUS_LABELS[row.status]}`}>
      <div className="flex flex-col gap-3 text-sm">
        <p>
          <span className="font-medium">{row.customerName}</span> ·{" "}
          <a href={`tel:${row.customerPhone.replace(/\s/g, "")}`} className="text-brand-blue underline">
            {row.customerPhone}
          </a>
        </p>
        <p>{row.address}</p>
        <ul className="text-ink-muted">
          {row.items.map((item) => (
            <li key={`${item.productName}-${item.variantName}`}>
              {item.quantity} × {item.productName} — {item.variantName}
            </li>
          ))}
        </ul>
        <p>
          {row.scheduledFor && `Prévue le ${formatDateTime(row.scheduledFor)} · `}Tentative(s) : {row.attempts}
          {row.failureReason && ` · dernier incident : ${row.failureReason}`}
        </p>
        <p className="font-semibold">{row.balance > 0 ? `À encaisser : ${formatFcfa(row.balance)}` : "Commande soldée"}</p>

        {(row.status === "ASSIGNED" || row.status === "FAILED") && !canStart && (
          <p className="text-ink-muted">La commande n&apos;est pas encore prête à livrer.</p>
        )}
        {/* Formulaires toujours montés : leur message de confirmation reste visible après l'étape. */}
        <ActionForm action={startMyDeliveryAction.bind(null, row.orderId)}>
          {canStart && (
            <div>
              <SubmitButton>Je pars livrer</SubmitButton>
            </div>
          )}
        </ActionForm>
        <ActionForm action={collectMyDeliveryAction.bind(null, row.orderId)}>
          {inTransit && row.balance > 0 && (
            <>
              <input type="hidden" name="idempotencyKey" value={randomUUID()} />
              <input type="hidden" name="amount" value={row.balance} />
              <div>
                <SubmitButton confirm={`Confirmer l'encaissement de ${formatFcfa(row.balance)} en espèces ?`}>Encaisser {formatFcfa(row.balance)} en espèces</SubmitButton>
              </div>
            </>
          )}
        </ActionForm>
        <ActionForm action={completeMyDeliveryAction.bind(null, row.orderId)}>
          {inTransit && (
            <>
              <div className="grid gap-3 sm:grid-cols-2">
                <TextField name="recipientName" label="Remise à (nom)" />
                <TextField name="proofNote" label="Observations" required={false} />
              </div>
              <div>
                <SubmitButton>Livraison effectuée</SubmitButton>
              </div>
            </>
          )}
        </ActionForm>
        <ActionForm action={failMyDeliveryAction.bind(null, row.orderId)}>
          {inTransit && (
            <>
              <TextField name="reason" label="Signaler un incident (client absent, adresse introuvable…)" />
              <div>
                <SubmitButton variant="danger">Enregistrer l&apos;échec</SubmitButton>
              </div>
            </>
          )}
        </ActionForm>
      </div>
    </Section>
  );
}

/** Livraisons du livreur interne connecté (décision 5) : seulement les siennes, rien d'autre. */
export default async function MyDeliveriesPage() {
  const user = await requirePermission("deliveries.update_own", "/admin/mes-livraisons");
  const rows = await listMyDeliveries(db, user);
  return (
    <div className="flex flex-col gap-6">
      <PageHeader title="Mes livraisons" />
      {rows.length === 0 ? <p className="text-ink-muted">Aucune livraison ne vous est attribuée pour le moment.</p> : rows.map((row) => <DeliveryCard key={row.orderId} row={row} />)}
    </div>
  );
}
