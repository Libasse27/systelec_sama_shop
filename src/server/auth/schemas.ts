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

export const PASSWORD_MISMATCH_MESSAGE = "Les mots de passe ne correspondent pas";

// Schéma du formulaire d'inscription : signUpSchema + confirmation (jamais transmise au service).
// `when` : par défaut Zod 4 saute les refinements d'objet si un autre champ est invalide ; on force
// la comparaison dès que les deux valeurs sont des chaînes, pour signaler l'écart en même temps
// que les autres erreurs. Chaînes brutes, sans trim (les mots de passe ne sont pas normalisés).
const hasPasswordPair = (value: unknown): boolean =>
  typeof value === "object" &&
  value !== null &&
  typeof (value as Record<string, unknown>).password === "string" &&
  typeof (value as Record<string, unknown>).passwordConfirmation === "string";

export const signUpFormSchema = signUpSchema
  .extend({ passwordConfirmation: z.string() })
  .refine((form) => form.password === form.passwordConfirmation, {
    error: PASSWORD_MISMATCH_MESSAGE,
    path: ["passwordConfirmation"],
    when: ({ value }) => hasPasswordPair(value),
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
