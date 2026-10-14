import { describe, expect, it } from "vitest";
import { categoryOptions } from "./category-options";

const rows = [
  { id: "b", parentId: null, name: "Électricité", isActive: true },
  { id: "a", parentId: null, name: "Réseaux", isActive: true },
  { id: "a1", parentId: "a", name: "Wi-Fi", isActive: false },
  { id: "a11", parentId: "a1", name: "Extérieur", isActive: true },
];

describe("categoryOptions", () => {
  it("suit l'arborescence et indente chaque niveau", () => {
    expect(categoryOptions(rows).map((option) => option.label)).toEqual([
      "Électricité",
      "Réseaux",
      "— Wi-Fi (inactive)",
      "— — Extérieur",
    ]);
  });

  it("exclut une catégorie et toute sa descendance", () => {
    expect(categoryOptions(rows, { exclude: "a1" }).map((option) => option.value)).toEqual(["b", "a"]);
  });
});
