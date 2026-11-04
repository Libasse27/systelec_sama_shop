const LOCAL_DATE_TIME = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})$/;

/**
 * Convertit la saisie d'un champ « datetime-local » (AAAA-MM-JJTHH:mm) en instant ISO UTC.
 * Dakar est à UTC+0 toute l'année (pas d'heure d'été) : l'heure saisie est donc déjà l'heure UTC.
 * Renvoie null si la saisie est vide, illisible ou désigne une date inexistante (30 février…).
 */
export function parseLocalDateTime(value: string | undefined): string | null {
  const match = LOCAL_DATE_TIME.exec(value?.trim() ?? "");
  if (!match) return null;
  const date = new Date(`${match[0]}:00.000Z`);
  if (Number.isNaN(date.getTime())) return null;
  const iso = date.toISOString();
  // Refuse les dates « corrigées » par le moteur (30 février → 2 mars).
  return iso.startsWith(`${match[1]}-${match[2]}-${match[3]}T${match[4]}:${match[5]}`) ? iso : null;
}

/** Instant ISO UTC → valeur d'un champ « datetime-local » (AAAA-MM-JJTHH:mm, heure de Dakar = UTC). */
export function toLocalDateTime(iso: string | null): string {
  return iso ? new Date(iso).toISOString().slice(0, 16) : "";
}
