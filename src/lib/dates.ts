/** Les dates sont stockées en UTC et affichées dans le fuseau de Dakar. */
export const BUSINESS_TIMEZONE = "Africa/Dakar";

const dateTimeFormatter = new Intl.DateTimeFormat("fr-FR", {
  timeZone: BUSINESS_TIMEZONE,
  dateStyle: "short",
  timeStyle: "short",
});

const dateFormatter = new Intl.DateTimeFormat("fr-FR", {
  timeZone: BUSINESS_TIMEZONE,
  dateStyle: "long",
});

export function formatDateTime(date: Date): string {
  return dateTimeFormatter.format(date);
}

export function formatDate(date: Date): string {
  return dateFormatter.format(date);
}

/** Année civile à Dakar (utilisée pour la numérotation des documents). */
export function businessYear(date: Date = new Date()): number {
  const year = new Intl.DateTimeFormat("en-US", { timeZone: BUSINESS_TIMEZONE, year: "numeric" }).format(date);
  return Number(year);
}

/** Date du jour à Dakar au format AAAA-MM-JJ (noms de fichiers exportés). */
export function businessDateKey(date: Date = new Date()): string {
  return new Intl.DateTimeFormat("en-CA", { timeZone: BUSINESS_TIMEZONE, year: "numeric", month: "2-digit", day: "2-digit" }).format(date);
}
