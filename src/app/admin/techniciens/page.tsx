import type { Metadata } from "next";
import { PageHeader } from "@/components/admin/admin-ui";
import { ActionForm, CheckboxField, SubmitButton, TextField } from "@/components/forms/form-controls";
import { requirePermission } from "@/server/auth/session";
import { db } from "@/server/db/client";
import { listTechnicians } from "@/server/modules/technicians/service";
import { saveTechnicianAction } from "./actions";

export const metadata: Metadata = { title: "Techniciens", robots: { index: false } };

/** Profils des comptes portant le rôle technicien : compétences, zones, disponibilité au planning. */
export default async function TechniciansPage() {
  const user = await requirePermission("interventions.manage", "/admin/techniciens");
  const technicians = await listTechnicians(db, user);

  return (
    <>
      <PageHeader title="Techniciens" />
      <p className="-mt-4 mb-4 text-sm text-ink-muted">
        Les comptes apparaissent ici dès qu&apos;ils portent le rôle « Technicien ». Seuls les profils actifs sont planifiables.
      </p>
      {technicians.length === 0 ? (
        <p className="rounded-xl border border-line bg-surface p-6 text-center text-ink-muted">Aucun compte technicien.</p>
      ) : (
        <ul className="flex flex-col gap-4">
          {technicians.map((technician) => (
            <li key={technician.userId} className="rounded-xl border border-line bg-surface p-4">
              <p className="font-semibold">
                {technician.name} <span className="text-sm font-normal text-ink-muted">· {technician.email}</span>
              </p>
              <p className="text-sm text-ink-muted">
                {technician.technicianId ? `${technician.openInterventions} intervention(s) planifiée(s) ou en cours` : "Profil à créer"}
              </p>
              <ActionForm action={saveTechnicianAction.bind(null, technician.userId)} className="mt-3">
                <div className="grid gap-3 sm:grid-cols-2">
                  <TextField name="skills" label="Compétences" required={false} defaultValue={technician.skills} />
                  <TextField name="zones" label="Zones d'intervention" required={false} defaultValue={technician.zones} />
                </div>
                <CheckboxField name="isActive" label="Disponible au planning" defaultChecked={technician.technicianId ? technician.isActive : true} />
                <div>
                  <SubmitButton variant="secondary">Enregistrer</SubmitButton>
                </div>
              </ActionForm>
            </li>
          ))}
        </ul>
      )}
    </>
  );
}
