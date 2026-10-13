import { beforeEach, describe, expect, it } from "vitest";
import { db } from "@/server/db/client";
import { resetDatabase } from "../../../../tests/setup/db";
import { formatBusinessNumber, nextBusinessNumber, nextSequenceValue } from "./service";

describe("numérotation métier (PostgreSQL)", () => {
  beforeEach(resetDatabase);

  it("formate CMD-2026-000042", () => {
    expect(formatBusinessNumber("order", 2026, 42)).toBe("CMD-2026-000042");
  });

  it("produit des numéros uniques et consécutifs sous concurrence", async () => {
    const values = await Promise.all(
      Array.from({ length: 25 }, () => db.$transaction((tx) => nextSequenceValue(tx, "order", 2026))),
    );
    expect([...values].sort((a, b) => a - b)).toEqual(Array.from({ length: 25 }, (_, i) => i + 1));
  });

  it("isole les compteurs par clé et par année", async () => {
    expect(await nextBusinessNumber(db, "order", 2026)).toBe("CMD-2026-000001");
    expect(await nextBusinessNumber(db, "order", 2027)).toBe("CMD-2027-000001");
    expect(await nextBusinessNumber(db, "receipt", 2026)).toBe("REC-2026-000001");
  });
});
