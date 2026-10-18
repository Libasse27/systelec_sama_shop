import { describe, expect, it } from "vitest";
import { isProcessingOverdue, processingDueAt } from "./policy";

const schedule = { days: [1, 2, 3, 4, 5, 6], ranges: [{ start: "08:00", end: "18:00" }] };
const at = (iso: string) => new Date(`${iso}Z`);

describe("politique de retours : délai de traitement (24 heures ouvrables)", () => {
  it("un retour déclaré le samedi soir doit être traité le mercredi à midi", () => {
    // Samedi 20 h → dimanche fermé → lundi, mardi (20 h) → mercredi 12 h.
    expect(processingDueAt(at("2026-10-24T20:00:00"), schedule)).toEqual(at("2026-10-28T12:00:00"));
  });

  it("en retard seulement sans première action, après l'échéance", () => {
    const entry = { createdAt: at("2026-10-19T09:00:00"), firstActionAt: null };
    expect(isProcessingOverdue(entry, schedule, at("2026-10-21T13:00:00"))).toBe(false);
    expect(isProcessingOverdue(entry, schedule, at("2026-10-21T13:00:01"))).toBe(true);
    expect(isProcessingOverdue({ ...entry, firstActionAt: at("2026-10-22T09:00:00") }, schedule, at("2026-10-30T09:00:00"))).toBe(false);
  });
});
