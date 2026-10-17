import { describe, expect, it } from "vitest";
import { assertFcfa, formatFcfa, includedVat, lineTotal, percentOf, roundFcfa, sumFcfa } from "./money";

const normalizeSpaces = (text: string) => text.replace(/[  ]/g, " ");

describe("money (FCFA entiers)", () => {
  it("refuse les montants non entiers", () => {
    expect(() => assertFcfa(10.5)).toThrow(RangeError);
    expect(assertFcfa(125_000)).toBe(125_000);
  });

  it("arrondit au plus proche, demi vers le haut", () => {
    expect(roundFcfa(2.5)).toBe(3);
    expect(roundFcfa(2.49)).toBe(2);
    expect(roundFcfa(-2.5)).toBe(-3);
    expect(Object.is(roundFcfa(-0.3), 0)).toBe(true); // jamais « -0 FCFA »
  });

  it("calcule un pourcentage avec la règle d'arrondi unique", () => {
    expect(percentOf(10_001, 50)).toBe(5_001); // 5000,5 → 5001
    expect(percentOf(19_990, 12.5)).toBe(2_499); // 2498,75 → 2499
    expect(() => percentOf(1_000, 120)).toThrow(RangeError);
  });

  it("calcule une ligne et une somme", () => {
    expect(lineTotal(15_000, 3)).toBe(45_000);
    expect(() => lineTotal(15_000, -1)).toThrow(RangeError);
    expect(sumFcfa([45_000, 2_000, -5_000])).toBe(42_000);
  });

  it("formate en FCFA", () => {
    expect(normalizeSpaces(formatFcfa(1_250_000))).toBe("1 250 000 FCFA");
  });

  it("calcule la TVA incluse dans un prix TTC (D6)", () => {
    expect(includedVat(118_000, 18)).toBe(18_000);
    expect(includedVat(10_000, 18)).toBe(1_525); // 1 525,42 arrondi
    expect(includedVat(10_000, 0)).toBe(0);
    expect(() => includedVat(10_000, 120)).toThrow(RangeError);
  });
});
