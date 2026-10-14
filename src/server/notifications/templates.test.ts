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
});
