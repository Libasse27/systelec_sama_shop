import { formatFcfa } from "@/lib/money";

/** Textes des notifications de commande (texte brut : e-mail et SMS). */
export type OrderTemplate = "order.placed" | "order.new_staff" | "order.status";

export interface OrderMessageData {
  number: string;
  customerName: string;
  total: number;
  fulfillment: "DELIVERY" | "PICKUP";
  statusLabel?: string;
  comment?: string | null;
}

export function renderOrderMessage(template: OrderTemplate, data: OrderMessageData): { subject: string; text: string } {
  const payment = data.fulfillment === "DELIVERY" ? "en espèces à la livraison" : "en espèces au retrait";
  switch (template) {
    case "order.placed":
      return {
        subject: `Commande ${data.number} reçue`,
        text: [
          `Bonjour ${data.customerName},`,
          `Nous avons bien reçu votre commande ${data.number} (total : ${formatFcfa(data.total)}).`,
          `Nous vous contacterons pour la confirmer. Paiement ${payment} uniquement : aucun paiement en ligne ne vous sera demandé.`,
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
  }
}
