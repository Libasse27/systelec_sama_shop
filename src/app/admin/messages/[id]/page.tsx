import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { PageHeader, Section } from "@/components/admin/admin-ui";
import { ActionForm, SubmitButton, TextAreaField } from "@/components/forms/form-controls";
import { telHref } from "@/lib/contact-links";
import { formatDateTime } from "@/lib/dates";
import { CONTACT_MESSAGE_STATUS_LABELS, CONTACT_SUBJECT_LABELS } from "@/lib/labels";
import { requirePermission } from "@/server/auth/session";
import { db } from "@/server/db/client";
import { getContactMessage } from "@/server/modules/contact/queries";
import { changeMessageStatusAction, saveMessageNotesAction } from "../actions";

export const metadata: Metadata = { title: "Message", robots: { index: false } };

export default async function AdminMessagePage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const user = await requirePermission("messages.manage", `/admin/messages/${id}`);
  const message = await getContactMessage(db, user, id);
  if (!message) notFound();

  return (
    <div className="flex flex-col gap-6">
      <PageHeader title={`Message ${message.number}`} />
      <Section title="Message">
        <dl className="grid gap-x-6 gap-y-2 text-sm sm:grid-cols-[12rem_1fr]">
          <dt className="text-ink-muted">Statut</dt>
          <dd className="font-semibold">
            {CONTACT_MESSAGE_STATUS_LABELS[message.status]}
            {message.closedAt && <span className="font-normal text-ink-muted"> le {formatDateTime(message.closedAt)}</span>}
          </dd>
          <dt className="text-ink-muted">Reçu le</dt>
          <dd>{formatDateTime(message.createdAt)}</dd>
          <dt className="text-ink-muted">Expéditeur</dt>
          <dd>
            {message.name} · {message.userId ? "compte client" : "invité"}
          </dd>
          {message.email && (
            <>
              <dt className="text-ink-muted">E-mail</dt>
              <dd>
                <a href={`mailto:${message.email}?subject=${encodeURIComponent(`Votre message ${message.number}`)}`} className="text-brand-blue underline">
                  {message.email}
                </a>
              </dd>
            </>
          )}
          {message.phone && (
            <>
              <dt className="text-ink-muted">Téléphone</dt>
              <dd>
                <a href={telHref(message.phone)} className="text-brand-blue underline">
                  {message.phone}
                </a>
              </dd>
            </>
          )}
          <dt className="text-ink-muted">Sujet</dt>
          <dd>{CONTACT_SUBJECT_LABELS[message.subject]}</dd>
          {message.reference && (
            <>
              <dt className="text-ink-muted">Référence citée</dt>
              <dd>{message.reference}</dd>
            </>
          )}
          <dt className="text-ink-muted">Message</dt>
          <dd className="whitespace-pre-line break-words">{message.message}</dd>
        </dl>
      </Section>

      <Section title="Traiter le message">
        {/* Formulaire toujours monté : le message de confirmation reste visible après le changement. */}
        <ActionForm action={changeMessageStatusAction.bind(null, message.id)}>
          <div className="flex flex-wrap gap-2">
            {message.status !== "IN_PROGRESS" && (
              <SubmitButton name="status" value="IN_PROGRESS" variant="secondary">
                {message.status === "CLOSED" ? "Rouvrir" : "Prendre en charge"}
              </SubmitButton>
            )}
            {message.status !== "CLOSED" && (
              <SubmitButton name="status" value="CLOSED">
                Marquer comme traité
              </SubmitButton>
            )}
          </div>
        </ActionForm>
        <div className="mt-4 border-t border-line pt-4">
          <ActionForm action={saveMessageNotesAction.bind(null, message.id)}>
            <TextAreaField name="internalNotes" label="Notes internes" required={false} rows={4} defaultValue={message.internalNotes} hint="Jamais visibles par l'expéditeur." />
            <div>
              <SubmitButton variant="secondary">Enregistrer les notes</SubmitButton>
            </div>
          </ActionForm>
        </div>
      </Section>
    </div>
  );
}
