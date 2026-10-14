import { describe, expect, it } from "vitest";
import { formatFcfa } from "@/lib/money";
import { renderOrderMessage } from "./templates";

const data = { number: "CMD-2026-000001", customerName: "Awa", total: 30_000, fulfillment: "PICKUP" as const };

describe("messages de commande", () => {
  it("rappelle le paiement en espèces, sans lien de paiement", () => {
    const { subject, text } = renderOrderMessage("order.placed", data);
    expect(subject).toBe("Commande CMD-2026-000001 reçue");
    expect(text).toContain(formatFcfa(30_000));
    expect(text).toContain("espèces au retrait");
    expect(text).not.toMatch(/https?:|carte|mobile money/i);
  });

  it("annonce un changement de statut avec son motif", () => {
    const { text } = renderOrderMessage("order.status", { ...data, statusLabel: "Annulée", comment: "Rupture fournisseur" });
    expect(text).toContain("Annulée");
    expect(text).toContain("Rupture fournisseur");
  });

  it("confirme un encaissement avec le reçu et le reste à payer", () => {
    const partial = renderOrderMessage("order.payment", { ...data, payment: { amount: 10_000, balance: 20_000, receiptNumber: "REC-2026-000004" } });
    expect(partial.text).toContain("REC-2026-000004");
    expect(partial.text).toContain(`Reste à payer : ${formatFcfa(20_000)}`);
    const full = renderOrderMessage("order.payment", { ...data, payment: { amount: 30_000, balance: 0, receiptNumber: "REC-2026-000005" } });
    expect(full.text).toContain("entièrement payée");
    expect(() => renderOrderMessage("order.payment", data)).toThrow(/absentes/);
  });
});
