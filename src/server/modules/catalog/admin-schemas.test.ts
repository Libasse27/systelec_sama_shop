import { describe, expect, it } from "vitest";
import { categoryInputSchema, newProductSchema } from "./admin-schemas";

describe("schémas d'administration du catalogue", () => {
  it("traite une catégorie parente vide (formulaire) comme une famille principale", () => {
    for (const parentId of ["", null, undefined]) {
      expect(categoryInputSchema.parse({ name: "Sécurité", parentId })).toMatchObject({ parentId: null, slug: "securite" });
    }
    expect(categoryInputSchema.parse({ name: "Caméras", parentId: "cat1" }).parentId).toBe("cat1");
  });

  it("refuse un prix barré inférieur ou égal au prix de vente", () => {
    const base = {
      product: { categoryId: "c", name: "Routeur", shortDescription: "Description courte.", description: "Description longue." },
      variant: { sku: "rt-1", name: "Standard", price: 10_000 },
    };
    expect(newProductSchema.parse(base).variant).toMatchObject({ sku: "RT-1", compareAtPrice: null });
    expect(newProductSchema.safeParse({ ...base, variant: { ...base.variant, compareAtPrice: 10_000 } }).success).toBe(false);
  });
});
