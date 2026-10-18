import { describe, expect, it } from "vitest";
import { amountRefusal, orderPaymentStatus, paymentStatusFor } from "./balance";

describe("paymentStatusFor (statut dérivé des encaissements)", () => {
  it("non payée, partiellement payée, payée", () => {
    expect(paymentStatusFor(10_000, 0)).toBe("UNPAID");
    expect(paymentStatusFor(10_000, 4_000)).toBe("PARTIALLY_PAID");
    expect(paymentStatusFor(10_000, 10_000)).toBe("PAID");
  });

  it("une commande à 0 FCFA n'a rien à encaisser", () => {
    expect(paymentStatusFor(0, 0)).toBe("PAID");
  });
});

describe("orderPaymentStatus (retours et remboursements)", () => {
  const paid = { total: 50_000, amountPaid: 50_000, refundedAmount: 0 };

  it("sans retour : statut des encaissements", () => {
    expect(orderPaymentStatus({ ...paid, returns: [] })).toBe("PAID");
    expect(orderPaymentStatus({ ...paid, returns: ["REJECTED", "COMPLETED"] })).toBe("PAID");
  });

  it("retour à vérifier, puis remboursement à verser, puis remboursement effectué", () => {
    expect(orderPaymentStatus({ ...paid, returns: ["RECEIVED"] })).toBe("TO_VERIFY");
    expect(orderPaymentStatus({ ...paid, returns: ["VERIFICATION"] })).toBe("TO_VERIFY");
    expect(orderPaymentStatus({ ...paid, returns: ["RECEIVED", "REFUND_PENDING"] })).toBe("REFUND_PENDING");
    expect(orderPaymentStatus({ total: 50_000, amountPaid: 25_000, refundedAmount: 25_000, returns: ["COMPLETED"] })).toBe("REFUNDED");
    expect(orderPaymentStatus({ total: 50_000, amountPaid: 25_000, refundedAmount: 25_000, returns: ["COMPLETED", "RECEIVED"] })).toBe("TO_VERIFY");
  });
});

describe("amountRefusal (contrôle d'un encaissement)", () => {
  const base = { total: 10_000, amountPaid: 0, partialPaymentEnabled: false };

  it("accepte le solde exact", () => {
    expect(amountRefusal({ ...base, amount: 10_000 })).toBeNull();
  });

  it("refuse un montant supérieur au reste à payer", () => {
    expect(amountRefusal({ ...base, amount: 10_001 })).toMatch(/dépasse le reste à payer/);
    expect(amountRefusal({ ...base, amountPaid: 6_000, partialPaymentEnabled: true, amount: 5_000 })).toMatch(/4\D000 FCFA/);
  });

  it("paiement partiel désactivé (D2) : seul le solde complet est accepté", () => {
    expect(amountRefusal({ ...base, amount: 4_000 })).toMatch(/paiement partiel est désactivé/);
  });

  it("paiement partiel activé : un acompte puis le solde", () => {
    expect(amountRefusal({ ...base, partialPaymentEnabled: true, amount: 4_000 })).toBeNull();
    expect(amountRefusal({ ...base, partialPaymentEnabled: true, amountPaid: 4_000, amount: 6_000 })).toBeNull();
  });

  it("refuse tout encaissement sur une commande soldée", () => {
    expect(amountRefusal({ ...base, amountPaid: 10_000, amount: 1 })).toBe("Déjà soldé : il ne reste rien à encaisser.");
  });
});
