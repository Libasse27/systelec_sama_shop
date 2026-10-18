/**
 * Heures ouvrables de la boutique (paramètre « businessHours »), à Dakar.
 * Dakar est à UTC+0 toute l'année (pas d'heure d'été) : l'heure locale est l'heure UTC.
 * Les jours fériés ne sont pas gérés : un jour férié ouvrable dans le paramètre compte comme ouvré.
 */
export interface BusinessHours {
  /** Jours ouvrables, ISO : 1 = lundi … 7 = dimanche. */
  days: readonly number[];
  /** Plages horaires de chaque jour ouvrable (HH:MM, fin exclue), sans chevauchement. */
  ranges: readonly { start: string; end: string }[];
}

const MINUTE_MS = 60_000;
const DAY_MS = 24 * 60 * MINUTE_MS;
/** Garde-fou : au-delà, le paramètre est incohérent (aucune plage exploitable). */
const MAX_DAYS_SCANNED = 366 * 2;

/** Minutes depuis minuit d'une heure HH:MM. */
export function minutesOfDay(time: string): number {
  const [hours, minutes] = time.split(":").map(Number);
  return (hours ?? 0) * 60 + (minutes ?? 0);
}

/** Jour ISO (1 = lundi … 7 = dimanche) d'un instant, à Dakar. */
export function isoWeekday(date: Date): number {
  return ((date.getUTCDay() + 6) % 7) + 1;
}

/**
 * Instant atteint après `hours` heures ouvrables comptées à partir de `start` : le temps hors des
 * plages (soirée, nuit, jours non ouvrables) n'est pas compté. Une demande faite le soir commence
 * à courir à l'ouverture suivante.
 */
export function addBusinessHours(start: Date, hours: number, schedule: BusinessHours): Date {
  if (!(hours >= 0)) throw new Error("Nombre d'heures ouvrables invalide");
  let remaining = Math.round(hours * 60) * MINUTE_MS;
  const ranges = [...schedule.ranges].map((range) => ({ start: minutesOfDay(range.start), end: minutesOfDay(range.end) })).sort((a, b) => a.start - b.start);
  const firstDay = Math.floor(start.getTime() / DAY_MS) * DAY_MS;
  for (let index = 0; index < MAX_DAYS_SCANNED; index += 1) {
    const dayStart = firstDay + index * DAY_MS;
    if (!schedule.days.includes(isoWeekday(new Date(dayStart)))) continue;
    for (const range of ranges) {
      const from = Math.max(start.getTime(), dayStart + range.start * MINUTE_MS);
      const to = dayStart + range.end * MINUTE_MS;
      if (to <= from) continue;
      if (remaining <= to - from) return new Date(from + remaining);
      remaining -= to - from;
    }
  }
  throw new Error("Heures ouvrables : aucune plage exploitable");
}
