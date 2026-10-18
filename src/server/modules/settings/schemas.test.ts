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

  it("logo téléversé uniquement (décision 4) ; liens http(s) seulement pour les réseaux sociaux", () => {
    const company = settingsDefaults.company;
    const withLogo = (logoUrl: string) => settingsSchemas.company.safeParse({ ...company, logoUrl }).success;
    expect(withLogo("https://cdn.example.sn/logo.png")).toBe(false);
    expect(withLogo("http://cdn.example.sn/logo.png")).toBe(false);
    expect(withLogo("javascript:alert(1)")).toBe(false);
    expect(withLogo("data:image/svg+xml,<svg/>")).toBe(false);
    expect(withLogo("/medias/identite/logo-0b6c1c55-6f9c-4b0b-9a43-5b3f0e4f7d11.png")).toBe(true);
    expect(withLogo("/medias/../../etc/passwd")).toBe(false);
    expect(withLogo("/medias/produits/x/logo.png")).toBe(false);
    expect(withLogo("//evil.example/logo.png")).toBe(false);

    const socialLinks = { ...company.socialLinks, facebook: "javascript:alert(1)" };
    expect(settingsSchemas.company.safeParse({ ...company, socialLinks }).success).toBe(false);
  });

  it("heures ouvrables : jours ISO, une ou deux plages ordonnées sans chevauchement", () => {
    const parse = (value: unknown) => settingsSchemas.businessHours.safeParse(value);
    expect(settingsDefaults.businessHours).toEqual({ days: [1, 2, 3, 4, 5, 6], ranges: [{ start: "08:00", end: "18:00" }] });
    const split = parse({ days: [5, 1], ranges: [{ start: "15:00", end: "18:00" }, { start: "08:00", end: "13:00" }] });
    expect(split.success && split.data).toEqual({ days: [1, 5], ranges: [{ start: "08:00", end: "13:00" }, { start: "15:00", end: "18:00" }] });
    expect(parse({ days: [], ranges: [{ start: "08:00", end: "18:00" }] }).success).toBe(false);
    expect(parse({ days: [0], ranges: [{ start: "08:00", end: "18:00" }] }).success).toBe(false);
    expect(parse({ days: [1, 1], ranges: [{ start: "08:00", end: "18:00" }] }).success).toBe(false);
    expect(parse({ days: [1], ranges: [{ start: "18:00", end: "08:00" }] }).success).toBe(false);
    expect(parse({ days: [1], ranges: [{ start: "8:00", end: "18:00" }] }).success).toBe(false);
    expect(parse({ days: [1], ranges: [{ start: "08:00", end: "14:00" }, { start: "13:00", end: "18:00" }] }).success).toBe(false);
    expect(parse({ days: [1], ranges: [] }).success).toBe(false);
  });

  it("impose la devise XOF et le fuseau Africa/Dakar", () => {
    expect(settingsSchemas.commerce.safeParse({ ...settingsDefaults.commerce, currency: "EUR" }).success).toBe(false);
    expect(settingsSchemas.commerce.safeParse({ ...settingsDefaults.commerce, timezone: "UTC" }).success).toBe(false);
  });

  it("TVA (D6) et avis (D8) : désactivés par défaut, taux borné", () => {
    expect(settingsDefaults.tax).toEqual({ vatDetailEnabled: false, vatRate: 18 });
    expect(settingsDefaults.features.reviewsEnabled).toBe(false);
    expect(settingsSchemas.tax.safeParse({ vatDetailEnabled: true, vatRate: 101 }).success).toBe(false);
    expect(settingsSchemas.tax.safeParse({ vatDetailEnabled: true, vatRate: 18.5 }).success).toBe(false);
  });
});
