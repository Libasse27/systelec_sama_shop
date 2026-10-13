import { describe, expect, it } from "vitest";
import { isValidSlug, slugify } from "./slug";

describe("slugify", () => {
  it("produit une URL lisible sans accents ni ponctuation", () => {
    expect(slugify("Vidéosurveillance et sécurité")).toBe("videosurveillance-et-securite");
    expect(slugify("  SSD & disques durs ! ")).toBe("ssd-et-disques-durs");
    expect(slugify("Points d'accès Wi-Fi")).toBe("points-d-acces-wi-fi");
  });

  it("reconnaît un identifiant d'URL valide", () => {
    expect(isValidSlug("demo-routeur-wi-fi-6")).toBe(true);
    for (const invalid of ["", "a\u0000b", "Majuscule", "a/b", "x".repeat(81)]) expect(isValidSlug(invalid)).toBe(false);
  });

  it("limite la longueur sans laisser de tiret final", () => {
    const slug = slugify("a ".repeat(100));
    expect(slug.length).toBeLessThanOrEqual(80);
    expect(slug.endsWith("-")).toBe(false);
  });
});
