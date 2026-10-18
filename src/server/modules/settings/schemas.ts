import { z } from "zod";

/**
 * Moyens de règlement PHYSIQUES uniquement. Aucun moyen électronique n'existe dans
 * cette liste et les schémas sont stricts : un paramètre inconnu est refusé.
 */
export const OFFLINE_PAYMENT_METHODS = ["CASH_ON_DELIVERY", "CASH_ON_PICKUP", "CASH_AFTER_SERVICE"] as const;
export type OfflinePaymentMethod = (typeof OFFLINE_PAYMENT_METHODS)[number];

const optionalText = (max: number) => z.string().trim().min(1).max(max).nullable();
// http(s) uniquement : ces liens sont rendus en <img src> et <a href> (pas de javascript:, data:…).
const optionalUrl = z.url({ protocol: /^https?$/ }).max(500).nullable();

/** Logo téléversé depuis l'administration (servi par /medias/identite/…), forme stricte. */
export const UPLOADED_LOGO_PATTERN = /^\/medias\/identite\/logo-[a-f0-9-]{36}\.(?:jpg|png|webp)$/;
// Logo (D13, décision 4 du propriétaire) : fichier téléversé UNIQUEMENT, jamais d'adresse externe
// (contrôlé aussi en base : contrainte site_settings_logo_check).
const logoUrl = z.string().regex(UPLOADED_LOGO_PATTERN, "Logo : fichier téléversé uniquement").nullable();

export const companySettingsSchema = z
  .object({
    companyName: z.string().trim().min(1).max(120),
    shopName: z.string().trim().min(1).max(120),
    logoUrl,
    phone: optionalText(30),
    whatsapp: optionalText(30),
    email: z.email().nullable(),
    address: optionalText(300),
    openingHours: optionalText(300),
    // Mentions légales des reçus (D7) : absentes d'un paramètre enregistré avant leur ajout.
    ninea: optionalText(40).default(null),
    rccm: optionalText(60).default(null),
    socialLinks: z
      .object({
        facebook: optionalUrl,
        instagram: optionalUrl,
        linkedin: optionalUrl,
        tiktok: optionalUrl,
      })
      .strict(),
  })
  .strict();

export const commerceSettingsSchema = z
  .object({
    currency: z.literal("XOF"),
    timezone: z.literal("Africa/Dakar"),
    guestCheckoutEnabled: z.boolean(),
    partialPaymentEnabled: z.boolean(),
    stockReservationHours: z.number().int().min(1).max(720),
  })
  .strict();

export const paymentSettingsSchema = z
  .object({
    enabledMethods: z.array(z.enum(OFFLINE_PAYMENT_METHODS)).min(1),
  })
  .strict();

/** TVA (D6) : prix saisis et affichés TTC ; détail sur les factures désactivé tant que non validé. */
export const taxSettingsSchema = z
  .object({
    vatDetailEnabled: z.boolean(),
    vatRate: z.number().int().min(0).max(100),
  })
  .strict();

/** Fonctions activables (D8 : avis clients désactivés au lancement). */
export const featureSettingsSchema = z
  .object({
    reviewsEnabled: z.boolean(),
  })
  .strict();

const TIME_OF_DAY = /^(?:[01]\d|2[0-3]):[0-5]\d$/;
const timeOfDay = z.string().regex(TIME_OF_DAY, "Heure au format HH:MM (00:00 à 23:59)");

/**
 * Heures ouvrables (décision 2 : délai de traitement des retours), à Dakar (UTC+0 toute l'année).
 * Jours ISO (1 = lundi … 7 = dimanche) et une ou deux plages par jour ouvrable. Jours fériés non gérés.
 */
export const businessHoursSchema = z
  .object({
    days: z
      .array(z.number().int().min(1).max(7))
      .min(1, "Choisissez au moins un jour ouvrable")
      .max(7)
      .refine((days) => new Set(days).size === days.length, "Jour en double")
      .transform((days) => [...days].sort((a, b) => a - b)),
    ranges: z
      .array(
        z
          .object({ start: timeOfDay, end: timeOfDay })
          .strict()
          .refine((range) => range.start < range.end, { message: "La fin doit suivre le début", path: ["end"] }),
      )
      .min(1, "Indiquez au moins une plage horaire")
      .max(2, "Deux plages au plus")
      .transform((ranges) => [...ranges].sort((a, b) => a.start.localeCompare(b.start)))
      .refine((ranges) => ranges.every((range, index) => index === 0 || ranges[index - 1]!.end <= range.start), "Les plages horaires se chevauchent"),
  })
  .strict();

export const settingsSchemas = {
  company: companySettingsSchema,
  commerce: commerceSettingsSchema,
  payments: paymentSettingsSchema,
  tax: taxSettingsSchema,
  features: featureSettingsSchema,
  businessHours: businessHoursSchema,
} as const;

export type SettingKey = keyof typeof settingsSchemas;
export type SettingValue<K extends SettingKey> = z.infer<(typeof settingsSchemas)[K]>;

/**
 * Valeurs par défaut. Aucune coordonnée réelle n'est inventée : elles restent vides
 * jusqu'à leur saisie dans l'administration. Choix par défaut = décisions D1–D3.
 */
export const settingsDefaults: { [K in SettingKey]: SettingValue<K> } = {
  company: {
    companyName: "SYSTELEC",
    shopName: "SYSTELEC SAMA-SHOP",
    logoUrl: null,
    phone: null,
    whatsapp: null,
    email: null,
    address: null,
    openingHours: null,
    ninea: null,
    rccm: null,
    socialLinks: { facebook: null, instagram: null, linkedin: null, tiktok: null },
  },
  commerce: {
    currency: "XOF",
    timezone: "Africa/Dakar",
    guestCheckoutEnabled: true,
    partialPaymentEnabled: false,
    stockReservationHours: 48,
  },
  payments: {
    enabledMethods: ["CASH_ON_DELIVERY", "CASH_ON_PICKUP", "CASH_AFTER_SERVICE"],
  },
  tax: { vatDetailEnabled: false, vatRate: 18 },
  features: { reviewsEnabled: false },
  // Lundi à samedi, 8 h – 18 h : 24 heures ouvrables ≈ 2 jours et demi d'ouverture.
  businessHours: { days: [1, 2, 3, 4, 5, 6], ranges: [{ start: "08:00", end: "18:00" }] },
};
