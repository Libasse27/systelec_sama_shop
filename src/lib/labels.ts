import { formatFcfa } from "./money";

type Condition = "NEW" | "REFURBISHED" | "USED";
type PricingMode = "FIXED" | "INDICATIVE" | "QUOTE_ONLY";

export const LOW_STOCK_THRESHOLD = 5;

const CONDITION_LABELS: Record<Condition, string> = {
  NEW: "Neuf",
  REFURBISHED: "Reconditionné",
  USED: "Occasion",
};

export function conditionLabel(condition: Condition): string {
  return CONDITION_LABELS[condition];
}

export type AvailabilityLevel = "in-stock" | "low" | "out";

/** Disponibilité réelle affichée au client (le stock exact n'est montré que s'il est faible). */
export function availability(available: number): { level: AvailabilityLevel; label: string } {
  if (available <= 0) return { level: "out", label: "Épuisé" };
  if (available <= LOW_STOCK_THRESHOLD) {
    return { level: "low", label: available === 1 ? "Plus qu'un exemplaire" : `Plus que ${available} en stock` };
  }
  return { level: "in-stock", label: "En stock" };
}

/** Libellé de tarif d'un service : jamais de prix inventé pour une prestation sur devis. */
export function servicePriceLabel(pricingMode: PricingMode, price: number | null): string {
  if (pricingMode === "QUOTE_ONLY" || price === null) return "Sur devis";
  return pricingMode === "INDICATIVE" ? `À partir de ${formatFcfa(price)}` : formatFcfa(price);
}
