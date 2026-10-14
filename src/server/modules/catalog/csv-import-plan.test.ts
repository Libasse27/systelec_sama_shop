import { describe, expect, it } from "vitest";
import { planCatalogImport, type CurrentVariant } from "./csv-import-plan";

const variant = (overrides: Partial<CurrentVariant> = {}): CurrentVariant => ({
  variantId: "v1",
  price: 10_000,
  compareAtPrice: null,
  costPrice: 7_000,
  alertThreshold: 2,
  onHand: 8,
  reserved: 3,
  ...overrides,
});
const current = new Map([
  ["RT-01", variant()],
  ["SW-02", variant({ variantId: "v2", price: 50_000, compareAtPrice: 60_000 })],
]);

describe("planCatalogImport", () => {
  it("calcule les seuls changements demandés, cellules vides inchangées", () => {
    const plan = planCatalogImport("sku;produit;prix;prix_barre;stock_compte\nrt-01;Routeur;12 000;;10\nSW-02;Switch;;;", current);
    expect(plan.errors).toEqual([]);
    expect(plan.unchanged).toBe(1);
    expect(plan.changes).toEqual([
      { line: 2, sku: "RT-01", variantId: "v1", fields: { price: { from: 10_000, to: 12_000 }, counted: { from: 8, to: 10 } } },
    ]);
  });

  it("retire le prix barré avec 0 et accepte le séparateur « , » et des en-têtes accentués", () => {
    const plan = planCatalogImport("SKU,Prix barré\nSW-02,0", current);
    expect(plan.changes[0]?.fields).toEqual({ compareAtPrice: { from: 60_000, to: null } });
  });

  it("relit l'export tel quel sans aucun changement", () => {
    const exported = "﻿sku;produit;prix;prix_barre;prix_achat;seuil_alerte;stock_physique;stock_reserve;stock_compte\r\nRT-01;Routeur;10000;;7000;2;8;3;\r\n";
    expect(planCatalogImport(exported, current)).toMatchObject({ changes: [], errors: [], unchanged: 1 });
  });

  it("signale chaque ligne fautive avec son numéro", () => {
    const plan = planCatalogImport(
      "sku;prix;prix_barre;stock_compte\nINCONNU;1;;\nRT-01;-5;;\nSW-02;70000;;\nRT-01;;;\n;1;;",
      current,
    );
    expect(plan.changes).toEqual([]);
    expect(plan.errors).toEqual([
      { line: 2, message: "INCONNU : référence inconnue (l'import ne crée pas de produit)" },
      { line: 3, message: "RT-01 : prix : nombre entier positif attendu" },
      { line: 4, message: "SW-02 : le prix barré doit être supérieur au prix de vente (0 pour le retirer)" },
      { line: 5, message: "RT-01 : SKU présent plusieurs fois dans le fichier" },
      { line: 6, message: "? : SKU manquant" },
    ]);
  });

  it("refuse une quantité comptée inférieure au réservé, un décimal ou un fichier sans colonne utile", () => {
    expect(planCatalogImport("sku;stock_compte\nRT-01;2", current).errors[0]?.message).toMatch(/réservé \(3\)/);
    expect(planCatalogImport("sku;prix\nRT-01;10,5", current).errors).toHaveLength(1);
    expect(planCatalogImport("sku;produit\nRT-01;x", current).errors[0]?.message).toMatch(/Aucune colonne modifiable/);
    expect(planCatalogImport("produit;prix\nx;1", current).errors[0]?.message).toMatch(/sku/);
    expect(planCatalogImport('sku;prix\n"RT-01;1', current).errors[0]?.message).toMatch(/Guillemet/);
  });
});
