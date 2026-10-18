import { Section } from "@/components/admin/admin-ui";
import { ActionForm, IntegerField, SubmitButton, TextAreaField, TextField } from "@/components/forms/form-controls";
import { formatFcfa } from "@/lib/money";
import type { AdminIntervention } from "@/server/modules/interventions/queries";
import { addPartAction, completeAction, removePartAction, saveReportAction, startAction } from "../actions";

/** Travail du technicien assigné (ou du responsable) : démarrage, rapport, pièces, fin des travaux. */
export function WorkSection({ intervention }: { intervention: AdminIntervention }) {
  const inProgress = intervention.status === "IN_PROGRESS";
  return (
    <>
      {(intervention.status === "SCHEDULED" || inProgress) && (
        <Section title="Démarrage">
          <ActionForm action={startAction.bind(null, intervention.id)}>
            {intervention.status === "SCHEDULED" ? (
              <div>
                <SubmitButton>Démarrer l&apos;intervention</SubmitButton>
              </div>
            ) : (
              <p className="text-sm text-ink-muted">Intervention en cours.</p>
            )}
          </ActionForm>
        </Section>
      )}

      {inProgress && (
        <Section title="Rapport d'intervention">
          <ActionForm action={saveReportAction.bind(null, intervention.id)}>
            <TextAreaField name="diagnosis" label="Diagnostic" rows={3} defaultValue={intervention.report?.diagnosis} />
            <TextAreaField name="workDone" label="Travaux réalisés" rows={3} defaultValue={intervention.report?.workDone} />
            <div className="grid gap-3 sm:grid-cols-[12rem_1fr]">
              <IntegerField name="timeSpentMin" label="Temps passé (minutes)" defaultValue={intervention.report?.timeSpentMin} />
              <TextAreaField name="observations" label="Observations" required={false} rows={2} defaultValue={intervention.report?.observations} />
            </div>
            <div>
              <SubmitButton variant="secondary">Enregistrer le rapport</SubmitButton>
            </div>
          </ActionForm>
        </Section>
      )}
      {!inProgress && intervention.report && <ReportView report={intervention.report} />}

      {(inProgress || intervention.parts.length > 0) && <PartsSection intervention={intervention} editable={inProgress} />}

      {(inProgress || intervention.status === "DONE") && (
        <Section title="Fin des travaux">
          <ActionForm action={completeAction.bind(null, intervention.id)}>
            {inProgress ? (
              <div className="flex flex-wrap items-end gap-2">
                <TextField name="customerSignOff" label="Personne présente qui constate la fin des travaux" className="min-w-64 flex-1" />
                <SubmitButton confirm="Terminer l'intervention ? Le rapport ne sera plus modifiable.">Terminer l&apos;intervention</SubmitButton>
              </div>
            ) : (
              <p className="text-sm text-ink-muted">Travaux terminés, constatés par {intervention.customerSignOff}.</p>
            )}
          </ActionForm>
        </Section>
      )}
    </>
  );
}

function ReportView({ report }: { report: NonNullable<AdminIntervention["report"]> }) {
  return (
    <Section title="Rapport d'intervention">
      <dl className="grid gap-x-6 gap-y-2 text-sm sm:grid-cols-[12rem_1fr]">
        <dt className="text-ink-muted">Diagnostic</dt>
        <dd className="whitespace-pre-line">{report.diagnosis}</dd>
        <dt className="text-ink-muted">Travaux réalisés</dt>
        <dd className="whitespace-pre-line">{report.workDone}</dd>
        <dt className="text-ink-muted">Temps passé</dt>
        <dd>{report.timeSpentMin} min</dd>
        {report.observations && (
          <>
            <dt className="text-ink-muted">Observations</dt>
            <dd className="whitespace-pre-line">{report.observations}</dd>
          </>
        )}
      </dl>
    </Section>
  );
}

function PartsSection({ intervention, editable }: { intervention: AdminIntervention; editable: boolean }) {
  return (
    <Section title="Pièces utilisées">
      {intervention.parts.length > 0 && (
        <ul className="mb-4 flex flex-col gap-2 text-sm">
          {intervention.parts.map((part) => (
            <li key={part.id} className="flex flex-wrap items-center justify-between gap-2">
              <span>
                {part.quantity} × {part.label}
                {part.sku && <span className="text-ink-muted"> · {part.sku} (sortie de stock)</span>}
                {part.unitCost !== null && <span className="text-ink-muted"> · coût {formatFcfa(part.unitCost * part.quantity)}</span>}
              </span>
              {editable && (
                <ActionForm action={removePartAction.bind(null, intervention.id, part.id)}>
                  <SubmitButton variant="secondary" confirm="Retirer cette pièce ? Une pièce du catalogue revient en stock.">
                    Retirer
                  </SubmitButton>
                </ActionForm>
              )}
            </li>
          ))}
        </ul>
      )}
      {editable && (
        <ActionForm action={addPartAction.bind(null, intervention.id)} resetOnSuccess>
          <div className="grid gap-3 sm:grid-cols-[10rem_1fr_8rem]">
            <TextField name="sku" label="Référence (SKU)" required={false} hint="Sortie de stock tracée." />
            <TextField name="label" label="Désignation" required={false} hint="Pour une pièce hors catalogue." />
            <IntegerField name="quantity" label="Quantité" defaultValue={1} />
          </div>
          <div>
            <SubmitButton variant="secondary">Ajouter la pièce</SubmitButton>
          </div>
        </ActionForm>
      )}
    </Section>
  );
}
