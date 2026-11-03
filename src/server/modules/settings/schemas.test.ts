import { describe, expect, it } from "vitest";
import { MAX_ANNOUNCEMENTS, OFFLINE_PAYMENT_METHODS, announcementItemSchema, announcementsSchema, paymentSettingsSchema, settingsDefaults, settingsSchemas } from "./schemas";

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
    // Horaires de la phase 9 conservés par défaut (lundi–samedi, 8 h – 18 h) ; jours fériés à saisir.
    expect(settingsDefaults.businessHours).toEqual({ days: [1, 2, 3, 4, 5, 6], ranges: [{ start: "08:00", end: "18:00" }], holidays: [] });
    const split = parse({ days: [5, 1], ranges: [{ start: "15:00", end: "18:00" }, { start: "08:00", end: "13:00" }] });
    // Paramètre enregistré avant la phase 10 (sans jours fériés) : toujours lisible.
    expect(split.success && split.data).toEqual({ days: [1, 5], ranges: [{ start: "08:00", end: "13:00" }, { start: "15:00", end: "18:00" }], holidays: [] });
    expect(parse({ days: [], ranges: [{ start: "08:00", end: "18:00" }] }).success).toBe(false);
    expect(parse({ days: [0], ranges: [{ start: "08:00", end: "18:00" }] }).success).toBe(false);
    expect(parse({ days: [1, 1], ranges: [{ start: "08:00", end: "18:00" }] }).success).toBe(false);
    expect(parse({ days: [1], ranges: [{ start: "18:00", end: "08:00" }] }).success).toBe(false);
    expect(parse({ days: [1], ranges: [{ start: "8:00", end: "18:00" }] }).success).toBe(false);
    expect(parse({ days: [1], ranges: [{ start: "08:00", end: "14:00" }, { start: "13:00", end: "18:00" }] }).success).toBe(false);
    expect(parse({ days: [1], ranges: [] }).success).toBe(false);
  });

  it("jours fériés : dates réelles AAAA-MM-JJ, triées, sans doublon, en nombre borné", () => {
    const parse = (holidays: unknown) => settingsSchemas.businessHours.safeParse({ ...settingsDefaults.businessHours, holidays });
    const sorted = parse(["2026-12-25", "2026-04-04"]);
    expect(sorted.success && sorted.data.holidays).toEqual(["2026-04-04", "2026-12-25"]);
    expect(parse(["2026-02-30"]).success).toBe(false);
    expect(parse(["25/12/2026"]).success).toBe(false);
    expect(parse(["2026-12-25", "2026-12-25"]).success).toBe(false);
    expect(parse(Array.from({ length: 201 }, (_, index) => new Date(Date.UTC(2026, 0, 1 + index)).toISOString().slice(0, 10))).success).toBe(false);
  });

  it("relances des vérifications (décision 4) : 12, 24 puis 48 heures ouvrables par défaut, paliers croissants", () => {
    const parse = (value: unknown) => settingsSchemas.returnReminders.safeParse(value);
    expect(settingsDefaults.returnReminders).toEqual({ firstReminderHours: 12, secondReminderHours: 24, escalationHours: 48 });
    expect(parse({ firstReminderHours: 4, secondReminderHours: 8, escalationHours: 16 }).success).toBe(true);
    expect(parse({ firstReminderHours: 24, secondReminderHours: 24, escalationHours: 48 }).success).toBe(false);
    expect(parse({ firstReminderHours: 12, secondReminderHours: 48, escalationHours: 24 }).success).toBe(false);
    expect(parse({ firstReminderHours: 0, secondReminderHours: 24, escalationHours: 48 }).success).toBe(false);
    expect(parse({ firstReminderHours: 12, secondReminderHours: 24, escalationHours: 1000 }).success).toBe(false);
    expect(parse({ ...settingsDefaults.returnReminders, extra: 1 }).success).toBe(false);
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

  it("garde la raison sociale historique des documents et affiche la boutique sous FUTANI SHOP", () => {
    const { companyName, shopName, ninea, rccm } = settingsDefaults.company;
    expect(companyName).toBe("SYSTELEC");
    expect(shopName).toBe("FUTANI SHOP");
    expect([ninea, rccm]).toEqual([null, null]);
  });
});

describe("paramètres : bandeau d'annonces", () => {
  const item = (overrides: Record<string, unknown> = {}) => ({
    id: "5b1f3a52-9c1e-4d52-8d55-0d1c3a6f7a10",
    text: "Livraison offerte ce week-end",
    href: "/produits",
    kind: "PROMOTION",
    isActive: true,
    startsAt: null,
    endsAt: null,
    ...overrides,
  });
  const itemOk = (overrides?: Record<string, unknown>) => announcementItemSchema.safeParse(item(overrides)).success;

  it("valeur par défaut : aucune annonce, rotation de 6 secondes", () => {
    expect(settingsDefaults.announcements).toEqual({ items: [], rotationSeconds: 6 });
  });

  it("accepte une annonce valide (lien interne, https, ou sans lien)", () => {
    expect(itemOk()).toBe(true);
    expect(itemOk({ href: "https://exemple.sn/offre" })).toBe(true);
    expect(itemOk({ href: null, kind: "ANNOUNCEMENT" })).toBe(true);
    expect(itemOk({ startsAt: "2026-11-01T08:00:00.000Z", endsAt: "2026-11-30T18:00:00Z" })).toBe(true);
  });

  it("refuse les liens dangereux ou ambigus", () => {
    for (const href of ["//evil.com", "/\\evil.com", "javascript:alert(1)", "http://exemple.sn", "data:text/html,x", "evil.com", "/a b", "ftp://exemple.sn", "https:evil.com", "https:/evil.com", "https://user:pw@evil.com", "https://user@evil.com"]) {
      expect(itemOk({ href }), href).toBe(false);
    }
  });

  it("borne le texte : non vide, 160 caractères au plus", () => {
    expect(itemOk({ text: "   " })).toBe(false);
    expect(itemOk({ text: "" })).toBe(false);
    expect(itemOk({ text: "a".repeat(160) })).toBe(true);
    expect(itemOk({ text: "a".repeat(161) })).toBe(false);
  });

  it("refuse une fin qui ne suit pas le début (instants comparés comme dates)", () => {
    expect(itemOk({ startsAt: "2026-11-01T08:00:00.000Z", endsAt: "2026-11-01T08:00:00Z" })).toBe(false);
    expect(itemOk({ startsAt: "2026-11-02T08:00:00.000Z", endsAt: "2026-11-01T08:00:00.000Z" })).toBe(false);
    expect(itemOk({ startsAt: "2026-11-01T08:00:00Z", endsAt: "2026-11-01T08:00:00.500Z" })).toBe(true);
  });

  it("refuse un type, un identifiant ou une clé inconnus", () => {
    expect(itemOk({ kind: "PUB" })).toBe(false);
    expect(itemOk({ id: "pas-un-uuid" })).toBe(false);
    expect(itemOk({ extra: 1 })).toBe(false);
  });

  it("limite la liste à 10 annonces d'identifiants distincts, et la rotation à 4–20 s", () => {
    const many = (count: number) => Array.from({ length: count }, (_, index) => item({ id: `5b1f3a52-9c1e-4d52-8d55-0d1c3a6f70${String(index).padStart(2, "0")}` }));
    const ok = (items: unknown[], rotationSeconds = 6) => announcementsSchema.safeParse({ items, rotationSeconds }).success;
    expect(ok(many(MAX_ANNOUNCEMENTS))).toBe(true);
    expect(ok(many(MAX_ANNOUNCEMENTS + 1))).toBe(false);
    expect(ok([item(), item()])).toBe(false);
    expect(ok([], 3)).toBe(false);
    expect(ok([], 21)).toBe(false);
    expect(ok([], 4)).toBe(true);
    expect(announcementsSchema.safeParse({ items: [], rotationSeconds: 6, extra: true }).success).toBe(false);
  });
});
