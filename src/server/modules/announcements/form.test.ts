import { describe, expect, it } from "vitest";
import { parseLocalDateTime } from "./form";

describe("parseLocalDateTime", () => {
  it("convertit une saisie locale (Dakar = UTC+0) en instant ISO UTC", () => {
    expect(parseLocalDateTime("2026-11-10T08:30")).toBe("2026-11-10T08:30:00.000Z");
  });

  it("renvoie null pour une saisie vide ou absente", () => {
    expect(parseLocalDateTime("")).toBeNull();
    expect(parseLocalDateTime("   ")).toBeNull();
    expect(parseLocalDateTime(undefined)).toBeNull();
  });

  it("renvoie null pour une saisie illisible ou une date inexistante", () => {
    for (const value of ["demain", "2026-11-10", "2026-11-10 08:30", "2026-02-30T08:30", "2026-11-10T25:00", "2026-13-01T00:00", "2026-11-10T08:30:00Z"]) {
      expect(parseLocalDateTime(value), value).toBeNull();
    }
  });
});
