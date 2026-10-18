import { Section } from "@/components/admin/admin-ui";
import { ActionForm, IntegerField, SelectField, SubmitButton, TextField } from "@/components/forms/form-controls";
import { businessDateKey, businessDateKeyIn, formatTime } from "@/lib/dates";
import { db } from "@/server/db/client";
import type { AdminIntervention } from "@/server/modules/interventions/queries";
import { listSchedulableTechnicians } from "@/server/modules/technicians/service";
import { scheduleAction } from "../actions";

const DEFAULT_DURATION_MINUTES = 120;

/** Planification (ou replanification) sur un créneau d'un technicien actif. */
export async function ScheduleSection({ intervention }: { intervention: AdminIntervention }) {
  if (intervention.status !== "TO_SCHEDULE" && intervention.status !== "SCHEDULED") return null;
  const technicians = await listSchedulableTechnicians(db);
  const current = intervention.appointments[0];
  const options = technicians.map((technician) => ({ value: technician.id, label: technician.zones ? `${technician.name} (${technician.zones})` : technician.name }));

  return (
    <Section title={intervention.status === "SCHEDULED" ? "Replanifier" : "Planifier"}>
      {technicians.length === 0 ? (
        <p className="text-sm text-ink-muted">Aucun technicien actif : créez d&apos;abord un profil technicien.</p>
      ) : (
        <ActionForm action={scheduleAction.bind(null, intervention.id)}>
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
            <SelectField name="technicianId" label="Technicien" options={options} defaultValue={intervention.technician?.id ?? options[0]?.value} />
            <TextField name="date" label="Date" type="date" defaultValue={current ? businessDateKey(current.startsAt) : businessDateKeyIn(1)} />
            <TextField name="time" label="Heure" type="time" defaultValue={current ? formatTime(current.startsAt) : "09:00"} />
            <IntegerField
              name="durationMinutes"
              label="Durée (minutes)"
              defaultValue={current ? Math.round((current.endsAt.getTime() - current.startsAt.getTime()) / 60_000) : DEFAULT_DURATION_MINUTES}
            />
          </div>
          <div>
            <SubmitButton>{intervention.status === "SCHEDULED" ? "Replanifier" : "Planifier"}</SubmitButton>
          </div>
        </ActionForm>
      )}
    </Section>
  );
}
