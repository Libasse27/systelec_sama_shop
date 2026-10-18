import { lineTotal, sumFcfa, type Fcfa } from "@/lib/money";

export interface PricedLine {
  unitPrice: Fcfa;
  quantity: number;
}

export interface DeliveryPricing {
  fee: Fcfa;
  /** Livraison offerte à partir de ce sous-total ; null = jamais offerte. */
  freeAbove: Fcfa | null;
}

export interface OrderTotals {
  subtotal: Fcfa;
  deliveryFee: Fcfa;
  discountTotal: Fcfa;
  total: Fcfa;
}

/**
 * Total d'une commande, TOUJOURS calculé côté serveur à partir des prix relus en base :
 * Σ(prix × quantité) + frais de livraison (offerts au-delà du seuil de la zone).
 * Retrait en boutique (delivery = null) : aucun frais. Aucune remise avant les promotions à règles.
 */
export function computeOrderTotals(lines: readonly PricedLine[], delivery: DeliveryPricing | null): OrderTotals {
  const subtotal = sumFcfa(lines.map((line) => lineTotal(line.unitPrice, line.quantity)));
  const deliveryFee = delivery === null || (delivery.freeAbove !== null && subtotal >= delivery.freeAbove) ? 0 : delivery.fee;
  const discountTotal = 0;
  return { subtotal, deliveryFee, discountTotal, total: subtotal + deliveryFee - discountTotal };
}
