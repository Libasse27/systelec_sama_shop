import { describe, expect, it } from "vitest";
import { detectImageType } from "./image-type";

const bytes = (...values: number[]) => Uint8Array.from(values);

describe("detectImageType", () => {
  it("reconnaît JPEG, PNG et WebP à leur signature", () => {
    expect(detectImageType(bytes(0xff, 0xd8, 0xff, 0xe0))).toBe("jpg");
    expect(detectImageType(bytes(0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0))).toBe("png");
    expect(detectImageType(bytes(0x52, 0x49, 0x46, 0x46, 1, 2, 3, 4, 0x57, 0x45, 0x42, 0x50))).toBe("webp");
  });

  it("refuse les autres contenus, même déguisés (SVG, HTML, RIFF non WebP, fichier tronqué)", () => {
    expect(detectImageType(new TextEncoder().encode("<svg xmlns='http://www.w3.org/2000/svg'/>"))).toBeNull();
    expect(detectImageType(new TextEncoder().encode("<html><script>alert(1)</script>"))).toBeNull();
    expect(detectImageType(bytes(0x52, 0x49, 0x46, 0x46, 1, 2, 3, 4, 0x57, 0x41, 0x56, 0x45))).toBeNull();
    expect(detectImageType(bytes(0xff, 0xd8))).toBeNull();
    expect(detectImageType(bytes())).toBeNull();
  });
});
