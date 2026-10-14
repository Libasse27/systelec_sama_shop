import type { Metadata } from "next";
import Link from "next/link";
import { PageHeader, secondaryLinkClass, stringParam } from "@/components/admin/admin-ui";
import { businessDateKey, businessDayRange, formatDate, formatTime } from "@/lib/dates";
import { INTERVENTION_STATUS_LABELS } from "@/lib/labels";
import { requireAnyPermission } from "@/server/auth/session";
import { db } from "@/server/db/client";
import { getPlanning, type PlanningSlot } from "@/server/modules/interventions/queries";

export const metadata: Metadata = { title: "Planning", robots: { index: false } };

const DAY_MS = 24 * 3600 * 1000;
const WEEK_DAYS = 7;

/** Lundi (journée de Dakar) de la semaine contenant la date. */
function mondayOf(date: Date): Date {
  const start = businessDayRange(businessDateKey(date))!.from;
  const offset = (start.getUTCDay() + 6) % 7; // 0 = lundi
  return new Date(start.getTime() - offset * DAY_MS);
}

type SearchParams = Promise<Record<string, string | string[] | undefined>>;

/** Rendez-vous de la semaine, par jour : tous les techniciens, ou seulement le technicien connecté. */
export default async function PlanningPage({ searchParams }: { searchParams: SearchParams }) {
  const user = await requireAnyPermission(["interventions.read", "interventions.manage", "interventions.update_own"], "/admin/planning");
  const requested = stringParam((await searchParams).semaine);
  const from = mondayOf(requested && businessDayRange(requested) ? businessDayRange(requested)!.from : new Date());
  const to = new Date(from.getTime() + WEEK_DAYS * DAY_MS);
  const slots = await getPlanning(db, user, { from, to });
  const days = Array.from({ length: WEEK_DAYS }, (_, index) => new Date(from.getTime() + index * DAY_MS));
  const byDay = (day: Date): PlanningSlot[] => slots.filter((slot) => businessDateKey(slot.startsAt) === businessDateKey(day));
  const weekLink = (offset: number) => `/admin/planning?semaine=${businessDateKey(new Date(from.getTime() + offset * WEEK_DAYS * DAY_MS))}`;

  return (
    <>
      <PageHeader title="Planning">
        <Link href={weekLink(-1)} className={secondaryLinkClass}>
          Semaine précédente
        </Link>
        <Link href={weekLink(1)} className={secondaryLinkClass}>
          Semaine suivante
        </Link>
      </PageHeader>
      <p className="-mt-4 mb-4 text-sm text-ink-muted">Semaine du {formatDate(from)}</p>
      <ol className="flex flex-col gap-3">
        {days.map((day) => {
          const daySlots = byDay(day);
          return (
            <li key={day.toISOString()} className="rounded-xl border border-line bg-surface p-3">
              <h2 className="text-sm font-semibold capitalize">
                {new Intl.DateTimeFormat("fr-FR", { timeZone: "Africa/Dakar", weekday: "long", day: "numeric", month: "long" }).format(day)}
              </h2>
              {daySlots.length === 0 ? (
                <p className="text-sm text-ink-muted">Aucun rendez-vous.</p>
              ) : (
                <ul className="mt-1 flex flex-col gap-1 text-sm">
                  {daySlots.map((slot) => (
                    <li key={`${slot.interventionId}-${slot.startsAt.toISOString()}`}>
                      {formatTime(slot.startsAt)}–{formatTime(slot.endsAt)} · {slot.technician} ·{" "}
                      <Link href={`/admin/interventions/${slot.interventionId}`} className="text-brand-blue underline">
                        {slot.interventionNumber}
                      </Link>{" "}
                      — {slot.customerName}, {slot.address} ({INTERVENTION_STATUS_LABELS[slot.status]})
                    </li>
                  ))}
                </ul>
              )}
            </li>
          );
        })}
      </ol>
    </>
  );
}
