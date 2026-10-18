import { describe, expect, it } from "vitest";
import { parseReportPeriod } from "./period";

describe("période d'un rapport", () => {
  it("par défaut : du premier du mois à aujourd'hui, bornes incluses", () => {
    const period = parseReportPeriod(undefined, undefined, "2026-10-16");
    expect(period).toEqual({
      fromKey: "2026-10-01",
      toKey: "2026-10-16",
      from: new Date("2026-10-01T00:00:00Z"),
      to: new Date("2026-10-17T00:00:00Z"),
    });
  });

  it("une seule journée", () => {
    expect(parseReportPeriod("2026-02-28", "2026-02-28")).toMatchObject({ from: new Date("2026-02-28T00:00:00Z"), to: new Date("2026-03-01T00:00:00Z") });
  });

  it("refuse une date invalide, une période inversée ou de plus de 366 jours", () => {
    expect(parseReportPeriod("2026-02-30", "2026-03-01")).toEqual({ error: expect.stringMatching(/Date invalide/) });
    expect(parseReportPeriod("x", undefined)).toHaveProperty("error");
    expect(parseReportPeriod("2026-03-02", "2026-03-01")).toEqual({ error: expect.stringMatching(/précéder/) });
    expect(parseReportPeriod("2025-01-01", "2026-01-02")).toEqual({ error: expect.stringMatching(/trop longue/) });
    expect(parseReportPeriod("2025-01-01", "2025-12-31")).not.toHaveProperty("error");
  });
});
