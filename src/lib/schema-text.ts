import { z } from "zod";

/** Texte facultatif d'un formulaire : espaces retirés, chaîne vide ou absente → null. */
export const optionalText = (max: number) =>
  z
    .string()
    .trim()
    .max(max)
    .optional()
    .nullable()
    .transform((value) => value || null);
