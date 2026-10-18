import { z } from "zod";
import { ValidationError } from "./errors";

// Messages de validation génériques en français (longueurs, types…).
z.config(z.locales.fr());

/** Erreurs par chemin de champ : « name », « variant.price », « specs.0.label »… */
export function fieldErrorsOf(error: z.ZodError): Record<string, string[]> {
  return error.issues.reduce<Record<string, string[]>>((errors, issue) => {
    const key = issue.path.map(String).join(".") || "_form";
    return { ...errors, [key]: [...(errors[key] ?? []), issue.message] };
  }, {});
}

/** Valide une entrée externe ; sinon ValidationError (détails : { fieldErrors }). */
export function parseInput<T extends z.ZodType>(schema: T, input: unknown, label: string): z.infer<T> {
  const parsed = schema.safeParse(input);
  if (!parsed.success) throw new ValidationError(`${label} invalide`, { fieldErrors: fieldErrorsOf(parsed.error) });
  return parsed.data;
}
