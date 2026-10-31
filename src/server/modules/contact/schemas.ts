import { z } from "zod";
import { optionalText } from "@/lib/schema-text";
import { phoneSchema } from "@/server/modules/orders/schemas";

export const CONTACT_SUBJECTS = ["GENERAL", "ORDER", "QUOTE", "AFTER_SALES", "PARTNERSHIP", "OTHER"] as const;
export const CONTACT_MESSAGE_MAX_LENGTH = 3000;

const optionalEmail = z
  .string()
  .trim()
  .toLowerCase()
  .max(254)
  .optional()
  .nullable()
  .transform((value) => value || null)
  .pipe(z.email("Adresse e-mail invalide").nullable());

const optionalPhone = z
  .string()
  .trim()
  .optional()
  .nullable()
  .transform((value) => value || null)
  .pipe(phoneSchema.nullable());

/** Message du formulaire public. Au moins un moyen de répondre : e-mail ou téléphone. */
export const contactMessageSchema = z
  .object({
    idempotencyKey: z.uuid(),
    // Recopié dans l'accusé de réception envoyé à une adresse non vérifiée : une seule ligne, sans lien.
    name: z
      .string()
      .trim()
      .min(2)
      .max(120)
      .regex(/^[^\p{Cc}\p{Cf}]+$/u, "Nom invalide")
      .refine((value) => !value.includes("://"), "Nom invalide"),
    email: optionalEmail,
    phone: optionalPhone,
    subject: z.enum(CONTACT_SUBJECTS, { error: "Choisissez un sujet" }),
    reference: optionalText(40),
    message: z.string().trim().min(10).max(CONTACT_MESSAGE_MAX_LENGTH),
    /** Champ piège invisible : rempli seulement par les robots. */
    website: z.string().max(0, "Message refusé").optional().nullable(),
  })
  .refine((value) => value.email !== null || value.phone !== null, {
    path: ["email"],
    message: "Indiquez un e-mail ou un téléphone pour que nous puissions vous répondre",
  });

export type ContactMessageInput = z.infer<typeof contactMessageSchema>;

/** Traitement par le personnel : prise en charge, clôture, réouverture. */
export const contactStatusSchema = z.object({ status: z.enum(["IN_PROGRESS", "CLOSED"]) });

export const contactNotesSchema = z.object({ internalNotes: optionalText(4000) });
