import { describe, expect, it } from "vitest";
import { availability, conditionLabel, servicePriceLabel } from "./labels";

const normalizeSpaces = (text: string) => text.replace(/[  ]/g, " ");

describe("libellés boutique", () => {
  it("traduit l'état du produit", () => {
    expect(conditionLabel("REFURBISHED")).toBe("Reconditionné");
  });

  it("affiche la disponibilité réelle", () => {
    expect(availability(0)).toEqual({ level: "out", label: "Épuisé" });
    expect(availability(-2).level).toBe("out");
    expect(availability(1).label).toBe("Plus qu'un exemplaire");
    expect(availability(3)).toEqual({ level: "low", label: "Plus que 3 en stock" });
    expect(availability(40)).toEqual({ level: "in-stock", label: "En stock" });
  });

  it("n'invente jamais de tarif pour une prestation sur devis", () => {
    expect(servicePriceLabel("QUOTE_ONLY", null)).toBe("Sur devis");
    expect(normalizeSpaces(servicePriceLabel("FIXED", 15_000))).toBe("15 000 FCFA");
    expect(normalizeSpaces(servicePriceLabel("INDICATIVE", 25_000))).toBe("À partir de 25 000 FCFA");
  });
});
