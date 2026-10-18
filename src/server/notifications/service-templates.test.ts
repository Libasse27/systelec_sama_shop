import { describe, expect, it } from "vitest";
import { formatFcfa } from "@/lib/money";
import { renderServiceMessage } from "./service-templates";

const data = { number: "INT-2026-000001", customerName: "Fatou" };

describe("messages des services techniques", () => {
  it("annonce le devis avec son total et sa validité, sans lien de paiement", () => {
    const { text } = renderServiceMessage("quote.sent", { ...data, number: "DEV-2026-000001", total: 180_000, validUntil: "13 novembre 2026" });
    expect(text).toContain(formatFcfa(180_000));
    expect(text).toContain("13 novembre 2026");
    expect(text).toContain("espèces");
    expect(text).not.toMatch(/https?:|carte|mobile money/i);
  });

  it("fin d'intervention : montant restant, ou rien à régler", () => {
    expect(renderServiceMessage("intervention.done", { ...data, total: 25_000 }).text).toContain(`Montant à régler en espèces : ${formatFcfa(25_000)}`);
    expect(renderServiceMessage("intervention.done", { ...data, total: 0 }).text).toContain("Aucun montant ne reste à régler");
  });

  it("refuse de rendre un message sans ses données obligatoires", () => {
    expect(() => renderServiceMessage("intervention.scheduled", data)).toThrow(/créneau/);
    expect(() => renderServiceMessage("intervention.payment", data)).toThrow(/encaissement/);
  });
});
