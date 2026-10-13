import { describe, expect, it } from "vitest";
import { slugify } from "./slug";

describe("slugify", () => {
  it("produit une URL lisible sans accents ni ponctuation", () => {
    expect(slugify("Vidéosurveillance et sécurité")).toBe("videosurveillance-et-securite");
    expect(slugify("  SSD & disques durs ! ")).toBe("ssd-et-disques-durs");
    expect(slugify("Points d'accès Wi-Fi")).toBe("points-d-acces-wi-fi");
  });

  it("limite la longueur sans laisser de tiret final", () => {
    const slug = slugify("a ".repeat(100));
    expect(slug.length).toBeLessThanOrEqual(80);
    expect(slug.endsWith("-")).toBe(false);
  });
});
