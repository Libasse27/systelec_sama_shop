import { describe, expect, it } from "vitest";
import { priceQuote } from "./pricing";
import { quoteDraftSchema } from "./schemas";

describe("priceQuote (§20 n° 19 : devis détaillé calculé par le serveur)", () => {
  it("calcule chaque ligne et le total, en FCFA entiers", () => {
    const quote = priceQuote([
      { kind: "MATERIAL", label: "Caméra IP", quantity: 4, unitPrice: 35_000 },
      { kind: "LABOR", label: "Pose et câblage", quantity: 6, unitPrice: 7_500 },
      { kind: "TRAVEL", label: "Déplacement", quantity: 1, unitPrice: 5_000 },
    ]);
    expect(quote.items.map((item) => [item.position, item.lineTotal])).toEqual([[0, 140_000], [1, 45_000], [2, 5_000]]);
    expect(quote).toMatchObject({ subtotal: 190_000, total: 190_000 });
  });

  it("un devis sans ligne vaut 0", () => {
    expect(priceQuote([])).toEqual({ items: [], subtotal: 0, total: 0 });
  });
});

describe("quoteDraftSchema", () => {
  const draft = { validUntil: "2026-11-30", items: [{ kind: "LABOR", label: "Diagnostic", quantity: 1, unitPrice: 10_000 }] };

  it("accepte un brouillon valide", () => {
    expect(quoteDraftSchema.safeParse(draft).success).toBe(true);
  });

  it("refuse les quantités et prix non entiers, négatifs ou démesurés, et un type inconnu", () => {
    for (const item of [
      { quantity: 1.5 },
      { quantity: 0 },
      { unitPrice: -1 },
      { unitPrice: 12.5 },
      { unitPrice: 50_000_001 },
      { kind: "DISCOUNT" },
      { label: " " },
    ]) {
      expect(quoteDraftSchema.safeParse({ ...draft, items: [{ ...draft.items[0], ...item }] }).success).toBe(false);
    }
  });
});
