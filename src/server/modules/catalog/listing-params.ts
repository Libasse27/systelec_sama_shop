import { z } from "zod";

export const PAGE_SIZE = 24;
const MAX_PAGE = 1000;

export const SORT_OPTIONS = {
  pertinence: "Pertinence",
  "prix-croissant": "Prix croissant",
  "prix-decroissant": "Prix décroissant",
  nouveautes: "Nouveautés",
} as const;

export type SortOption = keyof typeof SORT_OPTIONS;

// Un champ vide vaut « pas de borne » (sans ce prétraitement, "" serait converti en 0).
const optionalAmount = z.preprocess(
  (value) => (typeof value === "string" && value.trim() === "" ? undefined : value),
  z.coerce.number().int().min(0).max(100_000_000).optional().catch(undefined),
);

/**
 * Paramètres d'URL des listes de produits. Toute valeur invalide est ignorée (repli sur
 * le défaut) : une URL fantaisiste ne doit jamais provoquer d'erreur.
 */
const listingParamsSchema = z.object({
  q: z
    .string()
    // L'octet NUL est refusé par PostgreSQL : on le retire plutôt que d'échouer.
    .transform((value) => value.replace(/\u0000/g, ""))
    .pipe(z.string().trim().max(100))
    .optional()
    .catch(undefined)
    .transform((value) => value || undefined),
  tri: z.enum(Object.keys(SORT_OPTIONS) as [SortOption, ...SortOption[]]).catch("pertinence"),
  page: z.coerce.number().int().min(1).max(MAX_PAGE).catch(1),
  min: optionalAmount,
  max: optionalAmount,
  dispo: z
    .string()
    .optional()
    .transform((value) => value === "1")
    .catch(false),
  marque: z
    .string()
    .regex(/^[a-z0-9-]{1,80}$/)
    .optional()
    .catch(undefined),
});

export type ListingParams = z.infer<typeof listingParamsSchema>;
type RawSearchParams = Record<string, string | string[] | undefined>;

export function parseListingParams(raw: RawSearchParams): ListingParams {
  const first = Object.fromEntries(
    Object.entries(raw).map(([key, value]) => [key, Array.isArray(value) ? value[0] : value]),
  );
  const parsed = listingParamsSchema.parse({ tri: undefined, page: undefined, ...first });
  // Bornes de prix inversées : on les remet dans l'ordre plutôt que de ne rien afficher.
  if (parsed.min !== undefined && parsed.max !== undefined && parsed.min > parsed.max) {
    return { ...parsed, min: parsed.max, max: parsed.min };
  }
  return parsed;
}

/** Lien vers la même liste avec des paramètres modifiés (pagination, tri, filtres). */
export function listingHref(basePath: string, params: ListingParams, changes: Partial<ListingParams>): string {
  const next = { ...params, ...changes };
  const query = new URLSearchParams();
  if (next.q) query.set("q", next.q);
  if (next.tri !== "pertinence") query.set("tri", next.tri);
  if (next.min !== undefined) query.set("min", String(next.min));
  if (next.max !== undefined) query.set("max", String(next.max));
  if (next.dispo) query.set("dispo", "1");
  if (next.marque) query.set("marque", next.marque);
  if (next.page > 1) query.set("page", String(next.page));
  const search = query.toString();
  return search ? `${basePath}?${search}` : basePath;
}
