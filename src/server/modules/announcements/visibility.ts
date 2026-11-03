import type { AnnouncementKind, SettingValue } from "@/server/modules/settings/schemas";

/** Annonce telle que l'affiche le site public : aucun champ d'administration n'est exposé. */
export interface VisibleAnnouncement {
  id: string;
  text: string;
  href: string | null;
  kind: AnnouncementKind;
}

/**
 * Annonces à afficher à l'instant `now` : actives, début inclus (startsAt <= now), fin exclue
 * (now < endsAt) ; une borne nulle est illimitée. L'ordre saisi est conservé.
 */
export function selectVisible(value: SettingValue<"announcements">, now: Date): VisibleAnnouncement[] {
  const instant = now.getTime();
  return value.items
    .filter((item) => item.isActive)
    .filter((item) => item.startsAt === null || new Date(item.startsAt).getTime() <= instant)
    .filter((item) => item.endsAt === null || instant < new Date(item.endsAt).getTime())
    .map(({ id, text, href, kind }) => ({ id, text, href, kind }));
}
