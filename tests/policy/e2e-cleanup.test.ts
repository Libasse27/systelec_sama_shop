import { afterEach, describe, expect, it, vi } from "vitest";
import { failureLines, runWithCleanup } from "../../e2e/support/cleanup";

const failing = (message: string) => () => {
  throw new Error(message);
};

describe("lanceur E2E : une erreur de nettoyage ne masque jamais l'erreur d'origine", () => {
  afterEach(() => vi.restoreAllMocks());

  it("nettoie tout, dans l'ordre inverse de création, et rend le résultat", async () => {
    const order: string[] = [];
    const result = await runWithCleanup(async (defer) => {
      defer({ label: "verrou", run: () => void order.push("verrou") });
      defer({ label: "volume", run: () => void order.push("volume") });
      defer({ label: "conteneur", run: () => void order.push("conteneur") });
      return 3;
    });
    expect(result).toBe(3);
    expect(order).toEqual(["conteneur", "volume", "verrou"]);
  });

  it("échec seul : l'erreur d'origine est relancée telle quelle, après le nettoyage", async () => {
    const original = new Error("migration impossible");
    const cleaned: string[] = [];
    const outcome = runWithCleanup(async (defer) => {
      defer({ label: "conteneur", run: () => void cleaned.push("conteneur") });
      throw original;
    });
    await expect(outcome).rejects.toBe(original);
    expect(cleaned).toEqual(["conteneur"]);
  });

  it("échec puis échec du nettoyage : AggregateError, erreur d'origine en premier ; toutes les étapes tentées et journalisées", async () => {
    const logged = vi.spyOn(console, "error").mockImplementation(() => undefined);
    const original = new Error("migration impossible");
    const cleaned: string[] = [];
    const error = await runWithCleanup(async (defer) => {
      defer({ label: "verrou", run: () => void cleaned.push("verrou") });
      defer({ label: "volume", run: failing("volume encore utilisé") });
      defer({ label: "conteneur", run: failing("conteneur introuvable") });
      throw original;
    }).catch((caught: unknown) => caught);

    expect(error).toBeInstanceOf(AggregateError);
    const aggregate = error as AggregateError;
    expect(aggregate.message).toMatch(/^migration impossible/);
    expect(aggregate.errors[0]).toBe(original);
    expect(aggregate.errors.map((inner: Error) => inner.message)).toEqual(["migration impossible", "conteneur introuvable", "volume encore utilisé"]);
    expect(cleaned).toEqual(["verrou"]);
    expect(logged.mock.calls.map(([line]) => line)).toEqual([
      "E2E : échec du nettoyage (conteneur) : conteneur introuvable",
      "E2E : échec du nettoyage (volume) : volume encore utilisé",
    ]);
    expect(failureLines(aggregate)).toEqual([aggregate.message, "  1. migration impossible", "  2. conteneur introuvable", "  3. volume encore utilisé"]);
  });

  it("succès mais nettoyage incomplet : échec signalé (jamais un succès silencieux)", async () => {
    vi.spyOn(console, "error").mockImplementation(() => undefined);
    const outcome = runWithCleanup(async (defer) => {
      defer({ label: "dossier", run: failing("permission refusée") });
      return 0;
    });
    await expect(outcome).rejects.toThrow(/nettoyage incomplet/);
  });

  it("étapes asynchrones attendues ; erreur simple affichée sur une ligne", async () => {
    const cleaned: string[] = [];
    await runWithCleanup(async (defer) => {
      defer({ label: "asynchrone", run: async () => void cleaned.push("asynchrone") });
      return 0;
    });
    expect(cleaned).toEqual(["asynchrone"]);
    expect(failureLines(new Error("refus"))).toEqual(["refus"]);
  });
});
