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

export const companySettingsSchema = z
  .object({
    companyName: z.string().trim().min(1).max(120),
    shopName: z.string().trim().min(1).max(120),
    logoUrl: optionalUrl,
    phone: optionalText(30),
    whatsapp: optionalText(30),
    email: z.email().nullable(),
    address: optionalText(300),
    openingHours: optionalText(300),
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

export const settingsSchemas = {
  company: companySettingsSchema,
  commerce: commerceSettingsSchema,
  payments: paymentSettingsSchema,
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
};
