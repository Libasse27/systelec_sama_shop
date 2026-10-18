import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { PageHeader, Section } from "@/components/admin/admin-ui";
import { ActionForm, IntegerField, SubmitButton, TextAreaField, TextField } from "@/components/forms/form-controls";
import { formatDate, formatDateTime } from "@/lib/dates";
import { INTERVENTION_STATUS_LABELS, QUOTE_REQUEST_STATUS_LABELS, QUOTE_STATUS_LABELS, servicePriceLabel, URGENCY_LABELS } from "@/lib/labels";
import { formatFcfa } from "@/lib/money";
import { requirePermission } from "@/server/auth/session";
import { db } from "@/server/db/client";
import { getAdminRequest } from "@/server/modules/quotes/queries";
import { changeRequestStatusAction, createDirectInterventionAction, createQuoteAction } from "../actions";

export const metadata: Metadata = { title: "Demande de devis", robots: { index: false } };

export default async function AdminRequestPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const user = await requirePermission("quotes.read", `/admin/demandes/${id}`);
  const request = await getAdminRequest(db, user, id);
  if (!request) notFound();
  const open = request.status !== "ACCEPTED" && request.status !== "CANCELLED";
  const canManage = user.permissions.has("quotes.manage");

  return (
    <div className="flex flex-col gap-6">
      <PageHeader title={`Demande ${request.number}`} />
      <Section title="Demande">
        <dl className="grid gap-x-6 gap-y-2 text-sm sm:grid-cols-[12rem_1fr]">
          <dt className="text-ink-muted">Statut</dt>
          <dd className="font-semibold">{QUOTE_REQUEST_STATUS_LABELS[request.status]}</dd>
          <dt className="text-ink-muted">Urgence</dt>
          <dd className={request.urgency === "URGENT" ? "font-semibold text-red-800" : undefined}>{URGENCY_LABELS[request.urgency]}</dd>
          <dt className="text-ink-muted">Déposée le</dt>
          <dd>{formatDateTime(request.createdAt)}</dd>
          <dt className="text-ink-muted">Client</dt>
          <dd>
            {request.contact.name} · {request.contact.phone}
            {request.contact.email && ` · ${request.contact.email}`} · {request.hasAccount ? "compte client" : "invité"}
          </dd>
          {request.service && (
            <>
              <dt className="text-ink-muted">Service</dt>
              <dd>
                {request.service.name} ({servicePriceLabel(request.service.pricingMode, request.service.price)})
              </dd>
            </>
          )}
          <dt className="text-ink-muted">Adresse</dt>
          <dd>{request.address}</dd>
          <dt className="text-ink-muted">Besoin</dt>
          <dd className="whitespace-pre-line">{request.description}</dd>
          {request.availability && (
            <>
              <dt className="text-ink-muted">Disponibilités</dt>
              <dd>{request.availability}</dd>
            </>
          )}
          {request.closingNote && (
            <>
              <dt className="text-ink-muted">Motif de clôture</dt>
              <dd>{request.closingNote}</dd>
            </>
          )}
        </dl>
      </Section>

      {canManage && (
        <Section title="Traiter la demande">
          {/* Formulaire toujours monté : le message reste visible une fois la demande close. */}
          <ActionForm action={changeRequestStatusAction.bind(null, request.id)}>
            {open ? (
              <>
                <TextField name="note" label="Motif (clôture sans suite)" required={false} hint="Visible par le client." />
                <div className="flex flex-wrap gap-2">
                  {request.status === "NEW" && (
                    <SubmitButton name="status" value="IN_REVIEW" variant="secondary">
                      Prendre en charge
                    </SubmitButton>
                  )}
                  <SubmitButton name="status" value="CANCELLED" variant="danger" confirm="Clore cette demande sans suite ?">
                    Clore sans suite
                  </SubmitButton>
                </div>
              </>
            ) : (
              <p className="text-sm text-ink-muted">Demande close.</p>
            )}
          </ActionForm>
          {open && (
            <div className="mt-4 grid gap-4 border-t border-line pt-4 md:grid-cols-2">
              <ActionForm action={createQuoteAction.bind(null, request.id)}>
                <p className="text-sm">Établir un devis détaillé (matériel, main-d&apos;œuvre, déplacement).</p>
                <div>
                  <SubmitButton>Créer un devis</SubmitButton>
                </div>
              </ActionForm>
              {user.permissions.has("interventions.manage") && (
                <ActionForm action={createDirectInterventionAction.bind(null, request.id)}>
                  <p className="text-sm">Ou planifier directement une prestation à prix convenu, sans devis.</p>
                  <IntegerField name="amountDue" label="Montant convenu (FCFA)" defaultValue={request.service?.price ?? undefined} />
                  <TextAreaField name="problem" label="Travaux à réaliser" rows={2} defaultValue={request.description} />
                  <div>
                    <SubmitButton variant="secondary" confirm="Créer l'intervention à ce montant ?">
                      Créer l&apos;intervention
                    </SubmitButton>
                  </div>
                </ActionForm>
              )}
            </div>
          )}
        </Section>
      )}

      <Section title="Devis et interventions">
        {request.quotes.length === 0 && request.interventions.length === 0 ? (
          <p className="text-sm text-ink-muted">Aucun devis pour le moment.</p>
        ) : (
          <ul className="flex flex-col gap-1 text-sm">
            {request.quotes.map((quote) => (
              <li key={quote.id}>
                <Link href={`/admin/devis/${quote.id}`} className="font-medium text-brand-blue underline">
                  Devis {quote.number}
                </Link>{" "}
                — {QUOTE_STATUS_LABELS[quote.status]} · {formatFcfa(quote.total)} · valable jusqu&apos;au {formatDate(quote.validUntil)}
              </li>
            ))}
            {request.interventions.map((intervention) => (
              <li key={intervention.id}>
                <Link href={`/admin/interventions/${intervention.id}`} className="font-medium text-brand-blue underline">
                  Intervention {intervention.number}
                </Link>{" "}
                — {INTERVENTION_STATUS_LABELS[intervention.status]}
              </li>
            ))}
          </ul>
        )}
      </Section>
    </div>
  );
}
