import { z } from "zod";

/** Logo d'un partenaire : fichier téléversé uniquement (contrôlé aussi en base : partners_fields_check). */
export const PARTNER_LOGO_PATTERN = /^\/medias\/partenaires\/partenaire-[a-f0-9-]{36}\.(?:jpg|png|webp)$/;

/** Fiche d'un partenaire (hors logo, téléversé à part). Lien du site : https uniquement, facultatif. */
export const partnerSchema = z.object({
  name: z.string().trim().min(2, "Nom requis").max(120),
  websiteUrl: z.preprocess(
    (value) => (typeof value === "string" && value.trim() === "" ? null : value),
    z
      .url({ protocol: /^https$/, error: "Adresse https:// requise" })
      .max(500)
      // Pas d'identifiants dans l'adresse (https://site-de-confiance@autre-site.tld trompe le visiteur).
      .refine((url) => {
        try {
          const parsed = new URL(url);
          return parsed.username === "" && parsed.password === "";
        } catch {
          return false; // déjà signalée par la validation d'adresse
        }
      }, "Adresse sans identifiant ni mot de passe")
      .nullable()
      .optional(),
  ),
  isActive: z.boolean(),
  position: z.number({ error: "Ordre invalide" }).int("Ordre entier").min(0).max(10_000).default(0),
});

export type PartnerInput = z.infer<typeof partnerSchema>;
