import { describe, expect, it } from "vitest";
import { assertDisposableTestDatabase, type DisposableTestDatabase } from "../../tests/setup/test-database";

const runId = "a".repeat(24);
const context: DisposableTestDatabase = {
  url: `postgresql://it_${runId.slice(0, 12)}:secret@127.0.0.1:54321/systelec_test`,
  database: "systelec_test",
  user: `it_${runId.slice(0, 12)}`,
  port: 54321,
  runId,
  containerId: "b".repeat(64),
  containerLabel: runId,
};

describe("garde du PostgreSQL d'intégration jetable", () => {
  it("accepte uniquement l'URL et les identifiants injectés pour le run courant", () => {
    expect(assertDisposableTestDatabase(context)).toBe(context.url);
  });

  it.each([
    { port: 54322 },
    { user: "it_other" },
    { database: "systelec_test2" },
    { containerLabel: "other-run" },
    { containerId: "short" },
    { url: context.url.replace("127.0.0.1", "db.example") },
    { url: context.url.replace("54321", "54322") },
    { url: `${context.url}?schema=public` },
  ])("refuse les métadonnées incohérentes (%o)", (override) => {
    expect(() => assertDisposableTestDatabase({ ...context, ...override })).toThrow(/Refus/);
  });
});
