import { formatDateTime } from "@/lib/dates";
import { FULFILLMENT_LABELS, ORDER_STATUS_LABELS, PAYMENT_STATUS_LABELS } from "@/lib/labels";
import { formatFcfa } from "@/lib/money";
import type { OrderView } from "@/server/modules/orders/queries";

interface OrderDetailsProps {
  order: Omit<OrderView, "history"> & { history?: OrderView["history"] };
  /** Lien vers le PDF d'un reçu (avec le jeton du lien de suivi pour un invité). */
  receiptHref: (receiptNumber: string) => string;
}

/** Récapitulatif d'une commande (client invité, compte, administration). */
export function OrderDetails({ order, receiptHref }: OrderDetailsProps) {
  const balance = order.total - order.amountPaid;
  return (
    <div className="flex flex-col gap-4">
      <dl className="grid gap-x-6 gap-y-2 rounded-xl border border-line bg-surface p-4 text-sm sm:grid-cols-[12rem_1fr]">
        <dt className="text-ink-muted">Statut</dt>
        <dd className="font-semibold">{ORDER_STATUS_LABELS[order.status]}</dd>
        <dt className="text-ink-muted">Paiement</dt>
        <dd>
          {PAYMENT_STATUS_LABELS[order.paymentStatus]} — en espèces {order.fulfillmentMethod === "DELIVERY" ? "à la livraison" : "au retrait"}
        </dd>
        <dt className="text-ink-muted">Passée le</dt>
        <dd>{formatDateTime(order.createdAt)}</dd>
        <dt className="text-ink-muted">Mode</dt>
        <dd>{FULFILLMENT_LABELS[order.fulfillmentMethod]}</dd>
        {order.fulfillmentMethod === "DELIVERY" && order.shippingAddress && (
          <>
            <dt className="text-ink-muted">Adresse</dt>
            <dd>
              {order.shippingAddress.line1}, {order.shippingAddress.district}, {order.shippingAddress.city}
              {order.shippingAddress.landmark && ` (${order.shippingAddress.landmark})`}
              {order.deliveryZone && ` — zone ${order.deliveryZone.name}${order.deliveryZone.leadTimeText ? `, ${order.deliveryZone.leadTimeText}` : ""}`}
            </dd>
          </>
        )}
        {order.pickupPoint && (
          <>
            <dt className="text-ink-muted">Retrait</dt>
            <dd>
              {order.pickupPoint.name}, {order.pickupPoint.address}
              {order.pickupPoint.hours && ` — ${order.pickupPoint.hours}`}
            </dd>
          </>
        )}
        <dt className="text-ink-muted">Contact</dt>
        <dd>
          {order.contact.name} · {order.contact.phone}
          {order.contact.email && ` · ${order.contact.email}`}
        </dd>
        {order.notes && (
          <>
            <dt className="text-ink-muted">Remarques</dt>
            <dd>{order.notes}</dd>
          </>
        )}
      </dl>

      <div className="overflow-x-auto rounded-xl border border-line bg-surface">
        <table className="w-full text-left text-sm">
          <thead className="bg-surface-muted text-xs uppercase text-ink-muted">
            <tr>
              <th scope="col" className="px-3 py-2">Article</th>
              <th scope="col" className="px-3 py-2 text-right">Prix</th>
              <th scope="col" className="px-3 py-2 text-right">Qté</th>
              <th scope="col" className="px-3 py-2 text-right">Total</th>
            </tr>
          </thead>
          <tbody>
            {order.items.map((item) => (
              <tr key={item.sku} className="border-t border-line">
                <td className="px-3 py-2">
                  {item.productName}
                  <div className="text-xs text-ink-muted">
                    {item.variantName} · {item.sku}
                  </div>
                </td>
                <td className="whitespace-nowrap px-3 py-2 text-right">{formatFcfa(item.unitPrice)}</td>
                <td className="px-3 py-2 text-right">{item.quantity}</td>
                <td className="whitespace-nowrap px-3 py-2 text-right">{formatFcfa(item.lineTotal)}</td>
              </tr>
            ))}
          </tbody>
          <tfoot className="border-t border-line">
            <tr>
              <td colSpan={3} className="px-3 py-1 text-right">Sous-total</td>
              <td className="whitespace-nowrap px-3 py-1 text-right">{formatFcfa(order.subtotal)}</td>
            </tr>
            <tr>
              <td colSpan={3} className="px-3 py-1 text-right">Livraison</td>
              <td className="whitespace-nowrap px-3 py-1 text-right">{order.deliveryFee === 0 ? "Offerte" : formatFcfa(order.deliveryFee)}</td>
            </tr>
            <tr className="font-bold">
              <td colSpan={3} className="px-3 py-2 text-right">Total à payer en espèces</td>
              <td className="whitespace-nowrap px-3 py-2 text-right">{formatFcfa(order.total)}</td>
            </tr>
            {order.amountPaid > 0 && (
              <>
                <tr>
                  <td colSpan={3} className="px-3 py-1 text-right">Déjà payé</td>
                  <td className="whitespace-nowrap px-3 py-1 text-right">{formatFcfa(order.amountPaid)}</td>
                </tr>
                <tr className="font-bold">
                  <td colSpan={3} className="px-3 py-2 text-right">Reste à payer</td>
                  <td className="whitespace-nowrap px-3 py-2 text-right">{formatFcfa(balance)}</td>
                </tr>
              </>
            )}
          </tfoot>
        </table>
      </div>

      {order.payments.length > 0 && (
        <section aria-labelledby="recus" className="rounded-xl border border-line bg-surface p-4">
          <h2 id="recus" className="font-semibold">
            Reçus
          </h2>
          <ul className="mt-2 flex flex-col gap-1 text-sm">
            {order.payments.map((payment) => (
              <li key={payment.receiptNumber}>
                <a href={receiptHref(payment.receiptNumber)} target="_blank" rel="noopener" className="text-brand-blue underline">
                  Reçu {payment.receiptNumber} (PDF)
                </a>{" "}
                — {formatDateTime(payment.createdAt)} ·{" "}
                {payment.amount > 0 ? `${formatFcfa(payment.amount)} reçus en espèces` : `annulation de ${formatFcfa(-payment.amount)}`}
              </li>
            ))}
          </ul>
        </section>
      )}

      {order.history && order.history.length > 0 && (
        <section aria-labelledby="suivi" className="rounded-xl border border-line bg-surface p-4">
          <h2 id="suivi" className="font-semibold">
            Suivi
          </h2>
          <ol className="mt-2 flex flex-col gap-1 text-sm">
            {order.history.map((entry) => (
              <li key={`${entry.to}-${entry.createdAt.toISOString()}`}>
                {formatDateTime(entry.createdAt)} — {ORDER_STATUS_LABELS[entry.to as keyof typeof ORDER_STATUS_LABELS] ?? entry.to}
                {entry.comment && <span className="text-ink-muted"> ({entry.comment})</span>}
              </li>
            ))}
          </ol>
        </section>
      )}
    </div>
  );
}
