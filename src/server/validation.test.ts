import { describe, expect, it } from "vitest";
import { z } from "zod";
import { parseInput } from "./validation";

describe("parseInput", () => {
  it("renvoie la donnée validée", () => {
    expect(parseInput(z.object({ a: z.number() }), { a: 1 }, "Test")).toEqual({ a: 1 });
  });

  it("regroupe les erreurs par chemin de champ, en français", () => {
    const schema = z.object({ variant: z.object({ price: z.number() }), specs: z.array(z.object({ label: z.string().min(2) })) });
    try {
      parseInput(schema, { variant: { price: "x" }, specs: [{ label: "a" }] }, "Produit");
      expect.unreachable();
    } catch (error) {
      expect(error).toMatchObject({ code: "VALIDATION", message: "Produit invalide" });
      const { fieldErrors } = (error as { details: { fieldErrors: Record<string, string[]> } }).details;
      expect(Object.keys(fieldErrors)).toEqual(["variant.price", "specs.0.label"]);
      expect(fieldErrors["specs.0.label"]?.[0]).toMatch(/trop petit|caractères/i);
    }
  });
});
