import { lineTotal, sumFcfa } from "@/lib/money";
import type { QuoteItemInput } from "./schemas";

export interface PricedQuoteItem extends QuoteItemInput {
  position: number;
  lineTotal: number;
}

/** Lignes et total d'un devis, calculés par le serveur (montants entiers en FCFA, sans TVA détaillée : D6). */
export function priceQuote(items: readonly QuoteItemInput[]): { items: PricedQuoteItem[]; subtotal: number; total: number } {
  const priced = items.map((item, position) => ({ ...item, position, lineTotal: lineTotal(item.unitPrice, item.quantity) }));
  const subtotal = sumFcfa(priced.map((item) => item.lineTotal));
  return { items: priced, subtotal, total: subtotal };
}
