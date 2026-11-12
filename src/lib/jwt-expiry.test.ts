import { describe, expect, it } from "vitest";
import { isJwtUnexpired, jwtExpiry } from "./jwt-expiry";

const base64url = (value: object) => Buffer.from(JSON.stringify(value)).toString("base64url");
const jwt = (payload: object) => `${base64url({ alg: "ES256" })}.${base64url(payload)}.signature`;

describe("expiration d'un JWT", () => {
  it("lit exp dans la charge utile", () => {
    expect(jwtExpiry(jwt({ exp: 1_800_000_000 }))).toBe(1_800_000_000);
  });

  it("null si mal formé ou sans exp numérique", () => {
    for (const token of ["pas-un-jwt", "a.!!!.c", "a.b", jwt({ iss: "T" }), jwt({ exp: "demain" }), `x.${Buffer.from("{").toString("base64url")}.y`]) {
      expect(jwtExpiry(token)).toBeNull();
    }
  });

  it("encore valable seulement si exp est dans le futur", () => {
    const now = 1_700_000_000_000;
    expect(isJwtUnexpired(jwt({ exp: now / 1000 + 60 }), now)).toBe(true);
    expect(isJwtUnexpired(jwt({ exp: now / 1000 }), now)).toBe(false);
    expect(isJwtUnexpired("pas-un-jwt", now)).toBe(false);
  });
});
