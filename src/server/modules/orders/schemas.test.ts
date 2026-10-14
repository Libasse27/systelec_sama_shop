import { describe, expect, it } from "vitest";
import { checkoutSchema, phoneSchema } from "./schemas";

const base = {
  idempotencyKey: "5f0c6b8e-3f43-4a8e-9d0e-0a8b7f4c2d11",
  contact: { name: "Awa Diop", phone: "77 123 45 67", email: "" },
  fulfillment: { method: "PICKUP", pickupPointId: "pp1" },
};

describe("validation de la commande", () => {
  it("accepte une commande en retrait et normalise le contact", () => {
    expect(checkoutSchema.parse(base)).toMatchObject({ contact: { phone: "77 123 45 67", email: null }, notes: null });
  });

  it("exige une adresse complète pour une livraison", () => {
    const delivery = { ...base, fulfillment: { method: "DELIVERY", deliveryZoneId: "z1", address: { line1: "Rue 10", district: "", city: "Dakar" } } };
    expect(checkoutSchema.safeParse(delivery).success).toBe(false);
  });

  it("refuse un mode de remise inconnu et une clé d'idempotence malformée", () => {
    expect(checkoutSchema.safeParse({ ...base, fulfillment: { method: "DRONE" } }).success).toBe(false);
    expect(checkoutSchema.safeParse({ ...base, idempotencyKey: "123" }).success).toBe(false);
  });

  it("valide les numéros de téléphone", () => {
    for (const ok of ["771234567", "+221 77 123 45 67", "33 820 00 00"]) expect(phoneSchema.safeParse(ok).success).toBe(true);
    for (const bad of ["1234", "77-123-45-67", "abc", "+221 77 123 45 67 89 00 11"]) expect(phoneSchema.safeParse(bad).success).toBe(false);
  });
});
