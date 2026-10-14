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

const DAY_KEY = /^(\d{4})-(\d{2})-(\d{2})$/;

/**
 * Journée de Dakar [début, fin[ pour une date AAAA-MM-JJ, ou null si la date est invalide.
 * Dakar est à UTC+0 toute l'année (pas d'heure d'été) : la journée locale est la journée UTC.
 */
export function businessDayRange(key: string): { from: Date; to: Date } | null {
  const match = DAY_KEY.exec(key);
  if (!match) return null;
  const from = new Date(Date.UTC(Number(match[1]), Number(match[2]) - 1, Number(match[3])));
  if (businessDateKey(from) !== key) return null; // 2026-02-30, mois 13…
  return { from, to: new Date(from.getTime() + 24 * 3600 * 1000) };
}

const TIME_KEY = /^([01]\d|2[0-3]):([0-5]\d)$/;

/** Instant d'une date (AAAA-MM-JJ) et d'une heure (HH:MM) à Dakar (UTC+0 toute l'année), ou null. */
export function businessDateTime(day: string, time: string): Date | null {
  const range = businessDayRange(day);
  const match = TIME_KEY.exec(time);
  if (!range || !match) return null;
  return new Date(range.from.getTime() + (Number(match[1]) * 60 + Number(match[2])) * 60_000);
}

/** Heure à Dakar au format HH:MM. */
export function formatTime(date: Date): string {
  return new Intl.DateTimeFormat("fr-FR", { timeZone: BUSINESS_TIMEZONE, hour: "2-digit", minute: "2-digit" }).format(date);
}

/** Date de Dakar (AAAA-MM-JJ) dans `days` jours. */
export function businessDateKeyIn(days: number): string {
  return businessDateKey(new Date(Date.now() + days * 24 * 3600 * 1000));
}
