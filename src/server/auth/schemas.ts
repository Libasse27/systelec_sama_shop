import { z } from "zod";

// Mêmes bornes que la configuration Better Auth (auth.ts).
export const PASSWORD_MIN_LENGTH = 10;
export const PASSWORD_MAX_LENGTH = 128;

// Normalisation avant validation : « Awa@Example.SN » saisi avec des espaces reste valide.
const email = z.string().trim().toLowerCase().pipe(z.email("Adresse e-mail invalide").max(254));
const newPassword = z
  .string()
  .min(PASSWORD_MIN_LENGTH, `Le mot de passe doit contenir au moins ${PASSWORD_MIN_LENGTH} caractères`)
  .max(PASSWORD_MAX_LENGTH);

export const signUpSchema = z.object({
  name: z.string().trim().min(2, "Indiquez votre nom").max(120),
  email,
  phone: z
    .string()
    .trim()
    .regex(/^\+?[0-9 ]{7,20}$/, "Numéro de téléphone invalide")
    .optional()
    .or(z.literal("").transform(() => undefined)),
  password: newPassword,
});

export const signInSchema = z.object({
  email,
  password: z.string().min(1, "Saisissez votre mot de passe").max(PASSWORD_MAX_LENGTH),
});

export const passwordResetRequestSchema = z.object({ email });

export const passwordResetSchema = z.object({
  token: z.string().min(1).max(500),
  password: newPassword,
});

export type SignUpInput = z.infer<typeof signUpSchema>;
export type SignInInput = z.infer<typeof signInSchema>;
