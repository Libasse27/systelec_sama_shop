import { businessDateKey, businessDayRange } from "@/lib/dates";

/** Durée maximale d'un rapport (au-delà : plusieurs exports). */
export const MAX_REPORT_DAYS = 366;

export interface ReportPeriod {
  /** Début inclus et fin exclue (UTC = heure de Dakar). */
  from: Date;
  to: Date;
  /** Bornes saisies, incluses (AAAA-MM-JJ). */
  fromKey: string;
  toKey: string;
}

const DAY_MS = 24 * 3600 * 1000;

/**
 * Période d'un rapport depuis les paramètres d'URL « du » et « au » (inclus). Par défaut : du
 * premier jour du mois à aujourd'hui. Une date invalide ou une période inversée ou trop longue
 * renvoie une erreur lisible au lieu d'un rapport faux.
 */
export function parseReportPeriod(du: string | undefined, au: string | undefined, today: string = businessDateKey()): ReportPeriod | { error: string } {
  const toKey = au ?? today;
  const fromKey = du ?? `${toKey.slice(0, 8)}01`;
  const start = businessDayRange(fromKey);
  const end = businessDayRange(toKey);
  if (!start || !end) return { error: "Date invalide : utilisez le format AAAA-MM-JJ." };
  if (start.from > end.from) return { error: "La date de début doit précéder la date de fin." };
  if ((end.to.getTime() - start.from.getTime()) / DAY_MS > MAX_REPORT_DAYS) {
    return { error: `Période trop longue : ${MAX_REPORT_DAYS} jours au plus.` };
  }
  return { from: start.from, to: end.to, fromKey, toKey };
}
