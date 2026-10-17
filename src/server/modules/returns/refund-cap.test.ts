import { describe, expect, it } from "vitest";
import { maxRefundFor } from "./refund-cap";

describe("plafond de remboursement d'un retour", () => {
  it("sans remise : la valeur des articles", () => {
    expect(maxRefundFor(50_000, { subtotal: 100_000, discountTotal: 0 })).toBe(50_000);
  });

  it("avec remise : part de la remise déduite au prorata, arrondi en faveur de la boutique", () => {
    expect(maxRefundFor(50_000, { subtotal: 100_000, discountTotal: 20_000 })).toBe(40_000);
    expect(maxRefundFor(10_001, { subtotal: 30_000, discountTotal: 10_000 })).toBe(6_667); // 6 667,33
  });
});
