import { describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));
const { pdfText } = await import("./pdf-kit");

describe("pdfText (texte imprimable par la police intégrée)", () => {
  it("garde le français et la ponctuation typographique", () => {
    expect(pdfText("Œuvre « été » — 12 €, Ndèye")).toBe("Œuvre « été » — 12 €, Ndèye");
  });

  it("remplace les espaces insécables, les émojis et les autres alphabets", () => {
    expect(pdfText("1 000 FCFA")).toBe("1 000 FCFA");
    expect(pdfText("Awa 🙂 محمد")).toBe("Awa ? ????");
  });

  it("tronque un texte démesuré", () => {
    const text = pdfText("x".repeat(2_000));
    expect(text).toHaveLength(500);
    expect(text.endsWith("…")).toBe(true);
  });
});
