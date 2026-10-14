import { describe, expect, it } from "vitest";
import { computeOrderTotals } from "./pricing";

const lines = [
  { unitPrice: 12_500, quantity: 2 },
  { unitPrice: 3_000, quantity: 1 },
];

describe("computeOrderTotals (§20 : total calculé par le serveur)", () => {
  it("additionne les lignes et les frais de la zone", () => {
    expect(computeOrderTotals(lines, { fee: 2_000, freeAbove: null })).toEqual({
      subtotal: 28_000,
      deliveryFee: 2_000,
      discountTotal: 0,
      total: 30_000,
    });
  });

  it("offre la livraison à partir du seuil (inclus), pas en dessous", () => {
    expect(computeOrderTotals(lines, { fee: 2_000, freeAbove: 28_000 }).deliveryFee).toBe(0);
    expect(computeOrderTotals(lines, { fee: 2_000, freeAbove: 28_001 }).deliveryFee).toBe(2_000);
  });

  it("ne facture aucun frais au retrait en boutique", () => {
    expect(computeOrderTotals(lines, null)).toMatchObject({ deliveryFee: 0, total: 28_000 });
  });

  it("refuse une quantité ou un prix non entier", () => {
    expect(() => computeOrderTotals([{ unitPrice: 10.5, quantity: 1 }], null)).toThrow(RangeError);
    expect(() => computeOrderTotals([{ unitPrice: 10, quantity: 1.5 }], null)).toThrow(RangeError);
  });
});
