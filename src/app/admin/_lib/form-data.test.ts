import { describe, expect, it } from "vitest";
import { checkbox, int, labelValueLines, optionalInt, text, toLabelValueText } from "./form-data";

const form = (entries: Record<string, string>) => {
  const data = new FormData();
  for (const [key, value] of Object.entries(entries)) data.set(key, value);
  return data;
};

describe("lecture des formulaires d'administration", () => {
  it("lit textes, entiers et cases à cocher", () => {
    const data = form({ name: " Routeur ", price: "12 500", bad: "12,5", empty: "", featured: "on" });
    expect(text(data, "name")).toBe(" Routeur ");
    expect(text(data, "absent")).toBeUndefined();
    expect(int(data, "price")).toBe(12_500);
    expect(int(data, "bad")).toBeNaN();
    expect(int(data, "empty")).toBeUndefined();
    expect(optionalInt(data, "empty")).toBeNull();
    expect(checkbox(data, "featured")).toBe(true);
    expect(checkbox(data, "absent")).toBe(false);
  });

  it("convertit les lignes « Libellé : valeur » dans les deux sens", () => {
    const items = labelValueLines("Norme : Wi-Fi 6\n\n  Débit: 3 000 Mbit/s : max \nSans séparateur");
    expect(items).toEqual([
      { label: "Norme", value: "Wi-Fi 6" },
      { label: "Débit", value: "3 000 Mbit/s : max" },
      { label: "Sans séparateur", value: "" },
    ]);
    expect(labelValueLines(toLabelValueText(items.slice(0, 2)))).toEqual(items.slice(0, 2));
  });
});
