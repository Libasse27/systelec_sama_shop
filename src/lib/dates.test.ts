import { describe, expect, it } from "vitest";
import { businessDateKey, businessDateTime, businessDayRange, businessYear, formatDateTime } from "./dates";

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

describe("businessDayRange", () => {
  it("couvre la journée de Dakar, de minuit à minuit", () => {
    expect(businessDayRange("2026-10-14")).toEqual({ from: new Date("2026-10-14T00:00:00Z"), to: new Date("2026-10-15T00:00:00Z") });
  });

  it("refuse une date mal formée ou inexistante", () => {
    for (const key of ["", "2026-2-1", "2026-02-30", "2026-13-01", "14/10/2026", "2026-10-14T00:00"]) expect(businessDayRange(key)).toBeNull();
  });
});

describe("businessDateTime", () => {
  it("combine la date et l'heure de Dakar", () => {
    expect(businessDateTime("2026-10-20", "09:30")).toEqual(new Date("2026-10-20T09:30:00Z"));
  });

  it("refuse une heure ou une date invalide", () => {
    for (const [day, time] of [["2026-10-20", "24:00"], ["2026-10-20", "9:30"], ["2026-10-20", "09:60"], ["2026-02-30", "10:00"]]) {
      expect(businessDateTime(day!, time!)).toBeNull();
    }
  });
});
