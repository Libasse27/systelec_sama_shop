import { describe, expect, it } from "vitest";
import { parseCsv, toCsv } from "./csv";

describe("toCsv", () => {
  it("produit un CSV « ; » avec BOM, guillemets échappés et cellules vides", () => {
    expect(toCsv([["sku", "nom", "prix"], ["A-1", 'Câble "RJ45"; 2 m', 1500], ["B", null, undefined]])).toBe(
      '﻿sku;nom;prix\r\nA-1;"Câble ""RJ45""; 2 m";1500\r\nB;;\r\n',
    );
  });

  it("neutralise les cellules texte interprétables comme formules, pas les nombres", () => {
    expect(toCsv([["=HYPERLINK(\"x\")", "+33", "@a", -5]])).toBe('﻿"\'=HYPERLINK(""x"")";\'+33;\'@a;-5\r\n');
  });
});

describe("parseCsv", () => {
  it("relit ce que toCsv écrit", () => {
    const rows = [["sku", "nom"], ["A-1", 'Multi\nligne "x"; y'], ["B", ""]];
    expect(parseCsv(toCsv(rows))).toEqual(rows);
  });

  it("accepte le séparateur « , », les fins de ligne LF et ignore les lignes vides", () => {
    expect(parseCsv("sku,prix\nA,10\n\n,\nB,20")).toEqual([["sku", "prix"], ["A", "10"], ["B", "20"]]);
  });

  it("signale un guillemet non refermé", () => {
    expect(() => parseCsv('sku;nom\nA;"ouvert')).toThrow(/Guillemet/);
  });
});
