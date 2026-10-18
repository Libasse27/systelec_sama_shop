import type { OrderStatus, PaymentStatus, ReturnStatus } from "@/generated/prisma/client";
import { formatFcfa } from "@/lib/money";

/**
 * Statuts où une commande s'encaisse : confirmée, jamais annulée. Une commande remise au
 * client est forcément soldée ; elle se corrige par un retour et son remboursement (returns/).
 */
export const PAYABLE_ORDER_STATUSES: readonly OrderStatus[] = ["CONFIRMED", "PREPARING", "READY_FOR_PICKUP", "READY_TO_SHIP"];

/** Statut de paiement DÉRIVÉ des encaissements valides (jamais saisi à la main). */
export function paymentStatusFor(total: number, amountPaid: number): PaymentStatus {
  if (amountPaid <= 0) return total === 0 ? "PAID" : "UNPAID";
  return amountPaid >= total ? "PAID" : "PARTIALLY_PAID";
}

/**
 * Statut de paiement d'une commande, retours compris : un remboursement à verser prime, puis un
 * retour à vérifier, puis un remboursement effectué ; sinon le statut des encaissements.
 * `amountPaid` est net des remboursements : le montant réglé par le client est amountPaid + refundedAmount.
 */
export function orderPaymentStatus(input: { total: number; amountPaid: number; refundedAmount: number; returns: readonly ReturnStatus[] }): PaymentStatus {
  if (input.returns.includes("REFUND_PENDING")) return "REFUND_PENDING";
  if (input.returns.includes("RECEIVED") || input.returns.includes("VERIFICATION")) return "TO_VERIFY";
  if (input.refundedAmount > 0) return "REFUNDED";
  return paymentStatusFor(input.total, input.amountPaid + input.refundedAmount);
}

export interface AmountCheck {
  total: number;
  amountPaid: number;
  amount: number;
  partialPaymentEnabled: boolean;
}

/**
 * Motif de refus d'un encaissement, ou null s'il est acceptable.
 * - jamais au-delà du reste à payer (la monnaie rendue n'est pas encaissée) ;
 * - paiement partiel désactivé (D2) : seul le solde complet est accepté.
 */
export function amountRefusal({ total, amountPaid, amount, partialPaymentEnabled }: AmountCheck): string | null {
  const balance = total - amountPaid;
  if (balance <= 0) return "Déjà soldé : il ne reste rien à encaisser.";
  if (amount > balance) {
    return `Le montant dépasse le reste à payer (${formatFcfa(balance)}). N'encaissez que le montant dû, monnaie rendue.`;
  }
  if (!partialPaymentEnabled && amount !== balance) {
    return `Le paiement partiel est désactivé : encaissez le solde complet de ${formatFcfa(balance)}.`;
  }
  return null;
}
