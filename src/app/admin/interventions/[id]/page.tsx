import type { Metadata } from "next";
import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { PageHeader, Section } from "@/components/admin/admin-ui";
import { PaymentsSection } from "@/components/admin/payments-section";
import { ActionForm, SubmitButton, TextField } from "@/components/forms/form-controls";
import { formatDateTime, formatTime } from "@/lib/dates";
import { INTERVENTION_STATUS_LABELS, URGENCY_LABELS } from "@/lib/labels";
import { formatFcfa } from "@/lib/money";
import { requireUser } from "@/server/auth/session";
import { db } from "@/server/db/client";
import { AppError } from "@/server/errors";
import { getAdminIntervention, type AdminIntervention } from "@/server/modules/interventions/queries";
import { cancelAction, issueInvoiceAction } from "../actions";
import { ScheduleSection } from "./schedule-section";
import { WorkSection } from "./work-section";

export const metadata: Metadata = { title: "Intervention", robots: { index: false } };

async function load(id: string) {
  const user = await requireUser(`/admin/interventions/${id}`);
  try {
    return { user, intervention: await getAdminIntervention(db, user, id) };
  } catch (error) {
    if (error instanceof AppError && error.code === "FORBIDDEN") redirect("/acces-refuse");
    throw error;
  }
}

export default async function AdminInterventionPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const { user, intervention } = await load(id);
  if (!intervention) notFound();

  return (
    <div className="flex flex-col gap-6">
      <PageHeader title={`Intervention ${intervention.number}`} />
      <Summary intervention={intervention} />
      {intervention.canManage && <ScheduleSection intervention={intervention} />}
      {intervention.canWork && <WorkSection intervention={intervention} />}
      <PaymentsSection
        target={{ kind: "intervention", id: intervention.id }}
        total={intervention.amountDue}
        amountPaid={intervention.amountPaid}
        paymentStatus={intervention.paymentStatus}
        payable={intervention.status === "DONE" || "Encaissement après la prestation : l'intervention doit être terminée."}
        voidable
        user={user}
      />
      {intervention.canManage && <InvoiceAndCancel intervention={intervention} />}
    </div>
  );
}

function Summary({ intervention }: { intervention: AdminIntervention }) {
  const appointment = intervention.appointments[0];
  return (
    <Section title="Intervention">
      <dl className="grid gap-x-6 gap-y-2 text-sm sm:grid-cols-[12rem_1fr]">
        <dt className="text-ink-muted">Statut</dt>
        <dd className="font-semibold">{INTERVENTION_STATUS_LABELS[intervention.status]}</dd>
        <dt className="text-ink-muted">Client</dt>
        <dd>
          {intervention.contact.name} · {intervention.contact.phone}
        </dd>
        <dt className="text-ink-muted">Adresse</dt>
        <dd>{intervention.address}</dd>
        <dt className="text-ink-muted">Travaux</dt>
        <dd className="whitespace-pre-line">{intervention.problem}</dd>
        {intervention.quoteRequest && (
          <>
            <dt className="text-ink-muted">Demande</dt>
            <dd>
              <Link href={`/admin/demandes/${intervention.quoteRequest.id}`} className="text-brand-blue underline">
                {intervention.quoteRequest.number}
              </Link>{" "}
              · urgence {URGENCY_LABELS[intervention.quoteRequest.urgency].toLowerCase()}
              {intervention.quoteRequest.availability && ` · disponibilités : ${intervention.quoteRequest.availability}`}
            </dd>
          </>
        )}
        {intervention.quote && (
          <>
            <dt className="text-ink-muted">Devis</dt>
            <dd>
              <Link href={`/admin/devis/${intervention.quote.id}`} className="text-brand-blue underline">
                {intervention.quote.number}
              </Link>
            </dd>
          </>
        )}
        <dt className="text-ink-muted">Montant dû</dt>
        <dd>{formatFcfa(intervention.amountDue)}</dd>
        <dt className="text-ink-muted">Technicien</dt>
        <dd>
          {intervention.technician?.user.name ?? "Non attribué"}
          {appointment && ` · ${formatDateTime(appointment.startsAt)} – ${formatTime(appointment.endsAt)}`}
        </dd>
        {intervention.internalCost !== null && (
          <>
            <dt className="text-ink-muted">Coût interne des pièces</dt>
            <dd>{formatFcfa(intervention.internalCost)}</dd>
          </>
        )}
        {intervention.customerSignOff && (
          <>
            <dt className="text-ink-muted">Fin constatée par</dt>
            <dd>
              {intervention.customerSignOff}
              {intervention.completedAt && ` le ${formatDateTime(intervention.completedAt)}`}
            </dd>
          </>
        )}
        {intervention.cancelReason && (
          <>
            <dt className="text-ink-muted">Motif d&apos;annulation</dt>
            <dd>{intervention.cancelReason}</dd>
          </>
        )}
      </dl>
    </Section>
  );
}

function InvoiceAndCancel({ intervention }: { intervention: AdminIntervention }) {
  const cancellable = intervention.status !== "DONE" && intervention.status !== "CANCELLED";
  return (
    <>
      {intervention.status === "DONE" && (
        <Section title="Facture">
          <ActionForm action={issueInvoiceAction.bind(null, intervention.id)}>
            {intervention.invoice ? (
              <p className="text-sm">
                <a href={`/factures/${intervention.invoice.number}`} target="_blank" rel="noopener" className="font-medium text-brand-blue underline">
                  Facture {intervention.invoice.number} (PDF)
                </a>{" "}
                — émise le {formatDateTime(intervention.invoice.issuedAt)}
              </p>
            ) : (
              <div>
                <SubmitButton confirm="Émettre la facture ? Elle ne pourra plus être modifiée.">Émettre la facture</SubmitButton>
              </div>
            )}
          </ActionForm>
        </Section>
      )}
      {(cancellable || intervention.status === "CANCELLED") && (
        <Section title="Annulation">
          <ActionForm action={cancelAction.bind(null, intervention.id)}>
            {cancellable ? (
              <div className="flex flex-wrap items-end gap-2">
                <TextField name="reason" label="Motif" className="min-w-56 flex-1" />
                <SubmitButton variant="danger" confirm="Annuler cette intervention ? Le créneau sera libéré.">
                  Annuler l&apos;intervention
                </SubmitButton>
              </div>
            ) : (
              <p className="text-sm text-ink-muted">Intervention annulée.</p>
            )}
          </ActionForm>
        </Section>
      )}
    </>
  );
}
