import type { OrderStatus, PaymentStatus } from "@/generated/prisma/client";
import { formatFcfa } from "@/lib/money";

/**
 * Statuts où une commande s'encaisse : confirmée, jamais annulée. Une commande remise au
 * client est forcément soldée ; sa correction passera par un retour (phase 9).
 */
export const PAYABLE_ORDER_STATUSES: readonly OrderStatus[] = ["CONFIRMED", "PREPARING", "READY_FOR_PICKUP", "READY_TO_SHIP"];

/** Statut de paiement DÉRIVÉ des encaissements valides (jamais saisi à la main). */
export function paymentStatusFor(total: number, amountPaid: number): PaymentStatus {
  if (amountPaid <= 0) return total === 0 ? "PAID" : "UNPAID";
  return amountPaid >= total ? "PAID" : "PARTIALLY_PAID";
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
  if (balance <= 0) return "Cette commande est déjà soldée.";
  if (amount > balance) {
    return `Le montant dépasse le reste à payer (${formatFcfa(balance)}). N'encaissez que le montant dû, monnaie rendue.`;
  }
  if (!partialPaymentEnabled && amount !== balance) {
    return `Le paiement partiel est désactivé : encaissez le solde complet de ${formatFcfa(balance)}.`;
  }
  return null;
}
