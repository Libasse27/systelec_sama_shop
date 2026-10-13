import { describe, expect, it } from "vitest";
import { REDACTED, redact } from "./redact";

describe("redact", () => {
  it("masque les champs sensibles à toute profondeur sans muter l'original", () => {
    const input = { email: "a@b.sn", password: "x", nested: { sessionToken: "t", items: [{ passwordHash: "h", ok: 1 }] } };
    const output = redact(input);
    expect(output).toEqual({
      email: "a@b.sn",
      password: REDACTED,
      nested: { sessionToken: REDACTED, items: [{ passwordHash: REDACTED, ok: 1 }] },
    });
    expect(input.password).toBe("x");
  });

  it("sérialise les dates", () => {
    expect(redact({ at: new Date("2026-01-01T00:00:00Z") })).toEqual({ at: "2026-01-01T00:00:00.000Z" });
  });
});
