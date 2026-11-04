import { formatFcfa } from "@/lib/money";
import { ACCEPTED_PAYMENT_METHODS, paymentMethodPhrase, type PaymentMethod } from "@/lib/payment-methods";

/** Textes des notifications de commande (texte brut : e-mail et SMS). */
export type OrderTemplate = "order.placed" | "order.new_staff" | "order.status" | "order.payment" | "order.refund";

export interface OrderMessageData {
  number: string;
  customerName: string;
  total: number;
  fulfillment: "DELIVERY" | "PICKUP";
  statusLabel?: string;
  comment?: string | null;
  /** Encaissement (order.payment) : montant reçu, reste à payer, numéro du reçu. */
  payment?: { amount: number; balance: number; receiptNumber: string; method?: PaymentMethod };
  /** Remboursement d'un retour (order.refund). */
  refund?: { amount: number; returnNumber: string; receiptNumber: string; method?: PaymentMethod };
}

export function renderOrderMessage(template: OrderTemplate, data: OrderMessageData): { subject: string; text: string } {
  const moment = data.fulfillment === "DELIVERY" ? "à la livraison" : "au retrait";
  switch (template) {
    case "order.placed":
      return {
        subject: `Commande ${data.number} reçue`,
        text: [
          `Bonjour ${data.customerName},`,
          `Nous avons bien reçu votre commande ${data.number} (total : ${formatFcfa(data.total)}).`,
          `Nous vous contacterons pour la confirmer. Paiement ${moment}, ${ACCEPTED_PAYMENT_METHODS} : aucun paiement sur le site ne vous sera demandé.`,
        ].join("\n\n"),
      };
    case "order.new_staff":
      return {
        subject: `Nouvelle commande ${data.number}`,
        text: `Nouvelle commande ${data.number} de ${data.customerName}, total ${formatFcfa(data.total)}, à confirmer dans l'administration.`,
      };
    case "order.status":
      return {
        subject: `Commande ${data.number} : ${data.statusLabel}`,
        text: [`Bonjour ${data.customerName},`, `Votre commande ${data.number} est désormais : ${data.statusLabel}.`, data.comment ?? ""]
          .filter(Boolean)
          .join("\n\n"),
      };
    case "order.payment": {
      const payment = data.payment;
      if (!payment) throw new Error(`Données d'encaissement absentes (${data.number})`);
      return {
        subject: `Commande ${data.number} : paiement reçu`,
        text: [
          `Bonjour ${data.customerName},`,
          `Nous avons reçu ${formatFcfa(payment.amount)} ${paymentMethodPhrase(payment.method)} pour votre commande ${data.number} (reçu ${payment.receiptNumber}).`,
          payment.balance > 0 ? `Reste à payer : ${formatFcfa(payment.balance)}.` : "Votre commande est entièrement payée. Merci !",
        ].join("\n\n"),
      };
    }
    case "order.refund": {
      const refund = data.refund;
      if (!refund) throw new Error(`Données de remboursement absentes (${data.number})`);
      return {
        subject: `Commande ${data.number} : remboursement de ${formatFcfa(refund.amount)}`,
        text: [
          `Bonjour ${data.customerName},`,
          `Suite à votre retour ${refund.returnNumber}, nous vous avons remboursé ${formatFcfa(refund.amount)} ${paymentMethodPhrase(refund.method)} (reçu ${refund.receiptNumber}).`,
        ].join("\n\n"),
      };
    }
  }
}
