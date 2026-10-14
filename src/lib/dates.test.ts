import { describe, expect, it } from "vitest";
import { businessDateKey, businessYear, formatDateTime } from "./dates";

describe("dates (Africa/Dakar)", () => {
  it("affiche l'heure de Dakar (UTC+0, sans heure d'été)", () => {
    expect(formatDateTime(new Date("2026-07-01T14:30:00Z"))).toContain("14:30");
  });

  it("détermine l'année civile à Dakar", () => {
    expect(businessYear(new Date("2026-12-31T23:59:00Z"))).toBe(2026);
    expect(businessYear(new Date("2027-01-01T00:00:00Z"))).toBe(2027);
  });
});

describe("businessDateKey", () => {
  it("donne la date du jour à Dakar (UTC+0) au format AAAA-MM-JJ", () => {
    expect(businessDateKey(new Date("2026-10-13T23:59:00Z"))).toBe("2026-10-13");
    expect(businessDateKey(new Date("2026-01-01T00:00:00Z"))).toBe("2026-01-01");
  });
});
