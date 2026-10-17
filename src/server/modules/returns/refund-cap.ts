/**
 * Remboursement maximal d'articles retournés : leur valeur aux prix figés, diminuée de leur part
 * de la remise de la commande (au prorata du sous-total, arrondi en faveur de la boutique). Les
 * frais de livraison ne sont pas remboursés par ce plafond.
 */
export function maxRefundFor(itemsValue: number, order: { subtotal: number; discountTotal: number }): number {
  if (order.subtotal <= 0 || order.discountTotal <= 0) return itemsValue;
  return Math.floor((itemsValue * (order.subtotal - order.discountTotal)) / order.subtotal);
}
