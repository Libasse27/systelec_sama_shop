import { describe, expect, it } from "vitest";
import { safeRedirectPath } from "./redirect";

describe("safeRedirectPath", () => {
  it("accepte un chemin interne", () => {
    expect(safeRedirectPath("/compte?onglet=commandes", "/")).toBe("/compte?onglet=commandes");
  });

  it.each([
    "https://evil.example",
    "//evil.example",
    "/\\evil.example",
    "/\t/evil.example",
    "/\n/evil.example",
    "/\r/evil.example",
    "javascript:alert(1)",
    "",
    42,
    null,
  ])(
    "refuse %s (redirection ouverte)",
    (value) => {
      expect(safeRedirectPath(value, "/compte")).toBe("/compte");
    },
  );
});
