import { z } from "zod";
import { BRAND } from "@/lib/brand";

/**
 * Modalités du règlement EN ESPÈCES. Les paiements mobiles ne sont pas des paramètres : ils se choisissent
 * à l'encaissement (lib/payment-methods). Les schémas sont stricts : un paramètre inconnu est refusé.
 */
export const OFFLINE_PAYMENT_METHODS = ["CASH_ON_DELIVERY", "CASH_ON_PICKUP", "CASH_AFTER_SERVICE"] as const;
export type OfflinePaymentMethod = (typeof OFFLINE_PAYMENT_METHODS)[number];

const optionalText = (max: number) => z.string().trim().min(1).max(max).nullable();
// Lien social ENREGISTRÉ : tout texte est lisible. Un ancien lien devenu non conforme (http, domaine,
// protocole…) ne doit jamais rendre l'identité entière illisible (pied de page ramené aux valeurs par
// défaut, écran Paramètres en erreur). Il n'est jamais affiché : le pied de page ne publie que les liens
// acceptés par src/lib/social-links.ts, et toute saisie modifiée y est contrôlée (reviewSocialLinksInput).
const storedSocialLink = z.string().nullable();

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
        facebook: storedSocialLink,
        instagram: storedSocialLink,
        linkedin: storedSocialLink,
        tiktok: storedSocialLink,
        // Ajoutés après coup : absents d'un paramètre enregistré avant leur ajout.
        youtube: storedSocialLink.default(null),
        x: storedSocialLink.default(null),
      })
      .strict(),
  })
  .strict();

/** Lien social SAISI (formulaire) : texte borné ; les règles par réseau s'appliquent dans reviewSocialLinksInput. */
const socialInput = z.string().max(500).nullable();

/**
 * Identité SAISIE depuis l'administration : même forme que la valeur enregistrée, liens sociaux bornés.
 * Les liens sont ensuite contrôlés face à la valeur enregistrée (src/lib/social-links.ts, source unique) :
 * un lien modifié doit être conforme, un ancien lien laissé inchangé est conservé.
 */
export const companySettingsInputSchema = companySettingsSchema.extend({
  socialLinks: z
    .object({
      facebook: socialInput,
      instagram: socialInput,
      linkedin: socialInput,
      tiktok: socialInput,
      youtube: socialInput.default(null),
      x: socialInput.default(null),
    })
    .strict(),
});

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

/** Date civile réelle AAAA-MM-JJ (le 30 février est refusé). */
const civilDate = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/, "Date au format AAAA-MM-JJ")
  .refine((value) => {
    const date = new Date(`${value}T00:00:00Z`);
    return !Number.isNaN(date.getTime()) && date.toISOString().slice(0, 10) === value;
  }, "Date invalide");

/** Jours fériés enregistrables au plus (plusieurs années d'avance). */
export const MAX_HOLIDAYS = 200;

/**
 * Heures ouvrables (délais de traitement et relances des retours), à Dakar (UTC+0 toute l'année).
 * Jours ISO (1 = lundi … 7 = dimanche), une ou deux plages par jour ouvrable, et calendrier des jours
 * fériés (phase 10, décision 3) : un jour férié n'est jamais compté. Absent d'un paramètre enregistré
 * avant la phase 10 : aucun jour férié.
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
    holidays: z
      .array(civilDate)
      .max(MAX_HOLIDAYS, `${MAX_HOLIDAYS} jours fériés au plus`)
      .refine((days) => new Set(days).size === days.length, "Jour férié en double")
      .transform((days) => [...days].sort())
      .default([]),
  })
  .strict();

/** Délai d'une relance, en heures ouvrables (un mois ouvré au plus). */
const reminderHours = z.number().int("Nombre d'heures entier").min(1, "Au moins 1 heure").max(720, "720 heures au plus");

/**
 * Relances d'une vérification restée sans réponse (phase 10, décision 4), en heures ouvrables depuis
 * la demande : première relance, seconde relance, puis escalade aux administrateurs.
 */
export const returnRemindersSchema = z
  .object({
    firstReminderHours: reminderHours,
    secondReminderHours: reminderHours,
    escalationHours: reminderHours,
  })
  .strict()
  .refine((value) => value.firstReminderHours < value.secondReminderHours, { message: "La seconde relance doit suivre la première", path: ["secondReminderHours"] })
  .refine((value) => value.secondReminderHours < value.escalationHours, { message: "L'escalade doit suivre la seconde relance", path: ["escalationHours"] });

export const ANNOUNCEMENT_KINDS = ["ANNOUNCEMENT", "PROMOTION"] as const;
export type AnnouncementKind = (typeof ANNOUNCEMENT_KINDS)[number];

/** Chemin interne du site : commence par « / » mais jamais « // » ni « /\\ » (lien protocole-relatif ou détourné). */
const INTERNAL_PATH = /^\/(?![\/\\])[^\s\\]*$/;
// Interne ou https uniquement : ces liens sont rendus en <a href> (pas de javascript:, data:, http:…).
// Lien externe : « https:// » écrit en entier (z.url seul laisse passer « https:evil ») et sans
// identifiants dans l'adresse (« https://user:pw@hote » sert à l'hameçonnage).
const externalHttpsUrl = z
  .url({ protocol: /^https$/ })
  .max(500)
  .refine((value) => value.startsWith("https://"), "Lien externe : adresse complète commençant par https://")
  .refine((value) => {
    // Zod enchaîne les contrôles même après un échec : une adresse illisible est simplement refusée.
    const url = URL.parse(value);
    return url !== null && url.username === "" && url.password === "";
  }, "Lien externe : identifiants interdits dans l'adresse");
const announcementHref = z.union([z.string().max(300).regex(INTERNAL_PATH), externalHttpsUrl]).nullable();
const isoInstant = z.iso.datetime().nullable();

export const announcementItemSchema = z
  .object({
    id: z.uuid(),
    text: z.string().trim().min(1).max(160),
    href: announcementHref,
    kind: z.enum(ANNOUNCEMENT_KINDS),
    isActive: z.boolean(),
    startsAt: isoInstant,
    endsAt: isoInstant,
  })
  .strict()
  // Comparaison en instants (les formats ISO peuvent différer : « Z », millisecondes…).
  .refine((value) => !value.startsAt || !value.endsAt || new Date(value.endsAt).getTime() > new Date(value.startsAt).getTime(), { message: "La fin doit suivre le début", path: ["endsAt"] });

/** Annonces enregistrables au plus (le bandeau reste lisible). */
export const MAX_ANNOUNCEMENTS = 10;

/** Bandeau d'annonces et de promotions (géré par l'administrateur principal uniquement, voir announcements/admin.ts). */
export const announcementsSchema = z
  .object({
    items: z
      .array(announcementItemSchema)
      .max(MAX_ANNOUNCEMENTS, `${MAX_ANNOUNCEMENTS} annonces au plus`)
      .refine((items) => new Set(items.map((item) => item.id)).size === items.length, "Identifiant en double"),
    rotationSeconds: z.number().int().min(4).max(20),
  })
  .strict();

export const settingsSchemas = {
  company: companySettingsSchema,
  commerce: commerceSettingsSchema,
  payments: paymentSettingsSchema,
  tax: taxSettingsSchema,
  features: featureSettingsSchema,
  businessHours: businessHoursSchema,
  returnReminders: returnRemindersSchema,
  announcements: announcementsSchema,
} as const;

export type SettingKey = keyof typeof settingsSchemas;
export type SettingValue<K extends SettingKey> = z.infer<(typeof settingsSchemas)[K]>;

/**
 * Valeurs par défaut. Aucune coordonnée réelle n'est inventée : elles restent vides
 * jusqu'à leur saisie dans l'administration. Choix par défaut = décisions D1–D3.
 */
export const settingsDefaults: { [K in SettingKey]: SettingValue<K> } = {
  company: {
    // Raison sociale imprimée sur les factures et reçus : inchangée tant que l'entité juridique
    // n'est pas confirmée (FUTANI GROUP est une marque, pas une raison sociale validée).
    companyName: "SYSTELEC",
    shopName: BRAND.shop.name,
    logoUrl: null,
    phone: null,
    whatsapp: null,
    email: null,
    address: null,
    openingHours: null,
    ninea: null,
    rccm: null,
    socialLinks: { facebook: null, instagram: null, linkedin: null, tiktok: null, youtube: null, x: null },
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
  // Horaires validés en phase 9 : lundi à samedi, 8 h – 18 h (24 heures ouvrables ≈ 2 jours et demi
  // d'ouverture). La proposition lundi–vendredi, 9 h – 17 h (phase 10) n'est pas retenue par défaut tant
  // qu'elle n'est pas formellement approuvée ; un administrateur peut changer les horaires à l'écran.
  // Aucun jour férié n'est inventé : le calendrier se saisit dans l'administration.
  businessHours: { days: [1, 2, 3, 4, 5, 6], ranges: [{ start: "08:00", end: "18:00" }], holidays: [] },
  returnReminders: { firstReminderHours: 12, secondReminderHours: 24, escalationHours: 48 },
  // Aucune annonce inventée : le bandeau reste masqué tant que l'administrateur principal n'en publie pas.
  announcements: { items: [], rotationSeconds: 6 },
};
