import { describe, expect, it } from "vitest";
import { MAX_EMAIL_ATTEMPTS, nextAttemptAfter } from "./queue";

const NOW = new Date("2026-10-20T10:00:00Z");
const minutesLater = (date: Date | null) => (date ? (date.getTime() - NOW.getTime()) / 60_000 : null);

describe("calendrier des nouveaux essais d'un e-mail", () => {
  it("15 min, 1 h, 4 h, puis abandon au 4e envoi", () => {
    expect(MAX_EMAIL_ATTEMPTS).toBe(4);
    expect([1, 2, 3, 4].map((attempts) => minutesLater(nextAttemptAfter(attempts, new Error("timeout"), NOW)))).toEqual([15, 60, 240, null]);
  });

  it("refus définitif du destinataire (550, 551, 553) : aucun renvoi ; erreur temporaire (421, 535) : renvoi", () => {
    for (const responseCode of [550, 551, 553]) expect(nextAttemptAfter(1, Object.assign(new Error("refus"), { responseCode }), NOW)).toBeNull();
    for (const responseCode of [421, 535]) expect(minutesLater(nextAttemptAfter(1, Object.assign(new Error("temporaire"), { responseCode }), NOW))).toBe(15);
  });
});
