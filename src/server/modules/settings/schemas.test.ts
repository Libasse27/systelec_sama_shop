import { describe, expect, it } from "vitest";
import { OFFLINE_PAYMENT_METHODS, paymentSettingsSchema, settingsDefaults, settingsSchemas } from "./schemas";

describe("paramètres : schémas", () => {
  it("les valeurs par défaut sont valides et n'inventent aucune coordonnée", () => {
    for (const key of Object.keys(settingsSchemas) as (keyof typeof settingsSchemas)[]) {
      expect(settingsSchemas[key].safeParse(settingsDefaults[key]).success).toBe(true);
    }
    const { phone, email, address, whatsapp } = settingsDefaults.company;
    expect([phone, email, address, whatsapp]).toEqual([null, null, null, null]);
  });

  it("n'autorise que des moyens de règlement en espèces", () => {
    expect(OFFLINE_PAYMENT_METHODS.every((method) => method.startsWith("CASH_"))).toBe(true);
    for (const method of ["CARD", "WAVE", "ORANGE_MONEY", "PAYPAL", "STRIPE", "BANK_TRANSFER"]) {
      expect(paymentSettingsSchema.safeParse({ enabledMethods: [method] }).success).toBe(false);
    }
  });

  it("refuse tout champ inconnu (aucune clé de passerelle ne peut être ajoutée)", () => {
    const withGateway = { ...settingsDefaults.payments, stripeSecretKey: "sk_test" };
    expect(paymentSettingsSchema.safeParse(withGateway).success).toBe(false);
  });

  it("n'accepte que des liens http(s) pour le logo et les réseaux sociaux", () => {
    const company = settingsDefaults.company;
    const withLogo = (logoUrl: string) => settingsSchemas.company.safeParse({ ...company, logoUrl }).success;
    expect(withLogo("https://cdn.example.sn/logo.png")).toBe(true);
    expect(withLogo("javascript:alert(1)")).toBe(false);
    expect(withLogo("data:image/svg+xml,<svg/>")).toBe(false);

    const socialLinks = { ...company.socialLinks, facebook: "javascript:alert(1)" };
    expect(settingsSchemas.company.safeParse({ ...company, socialLinks }).success).toBe(false);
  });

  it("impose la devise XOF et le fuseau Africa/Dakar", () => {
    expect(settingsSchemas.commerce.safeParse({ ...settingsDefaults.commerce, currency: "EUR" }).success).toBe(false);
    expect(settingsSchemas.commerce.safeParse({ ...settingsDefaults.commerce, timezone: "UTC" }).success).toBe(false);
  });
});
