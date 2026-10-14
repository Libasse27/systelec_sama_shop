import type { Metadata } from "next";
import { randomUUID } from "node:crypto";
import { ActionForm, CheckboxField, SubmitButton, TextAreaField, TextField } from "@/components/forms/form-controls";
import { stringParam } from "@/components/admin/admin-ui";
import { getCurrentUser } from "@/server/auth/session";
import { db } from "@/server/db/client";
import { getServiceDetail } from "@/server/modules/services/queries";
import { submitQuoteRequestAction } from "../actions";

export const metadata: Metadata = {
  title: "Demande de devis",
  description: "Décrivez votre besoin (installation, dépannage, maintenance) : nous vous envoyons un devis détaillé.",
  alternates: { canonical: "/devis/demande" },
};

type Props = { searchParams: Promise<Record<string, string | string[] | undefined>> };

/** Demande de devis ou d'intervention, avec ou sans compte (téléphone obligatoire). */
export default async function QuoteRequestPage({ searchParams }: Props) {
  const slug = stringParam((await searchParams).service);
  const [user, service] = await Promise.all([getCurrentUser(), slug ? getServiceDetail(db, slug) : null]);

  return (
    <main className="mx-auto max-w-2xl px-4 py-8">
      <h1 className="text-2xl font-bold">Demande de devis ou d&apos;intervention</h1>
      <p className="mt-2 text-ink-muted">
        {service ? `Service : ${service.name}. ` : ""}Décrivez votre besoin : nous l&apos;étudions et vous envoyons un devis détaillé. Règlement en espèces,
        après la prestation.
      </p>
      <ActionForm action={submitQuoteRequestAction} className="mt-6">
        <input type="hidden" name="idempotencyKey" value={randomUUID()} />
        {service && <input type="hidden" name="service" value={service.slug} />}
        <fieldset className="grid gap-4 sm:grid-cols-2">
          <legend className="mb-2 font-semibold">Vos coordonnées</legend>
          <TextField name="name" label="Nom complet" defaultValue={user?.name} />
          <TextField name="phone" label="Téléphone" type="tel" hint="Nous vous appelons pour préciser la demande." />
          <TextField name="email" label="E-mail" type="email" required={false} defaultValue={user?.email} className="sm:col-span-2" />
        </fieldset>
        <TextField name="address" label="Adresse de l'intervention" hint="Quartier, ville et point de repère." />
        <TextAreaField name="description" label="Votre besoin" rows={5} hint="Matériel concerné, symptômes, nombre d'équipements…" />
        <TextField name="availability" label="Vos disponibilités" required={false} hint="Par exemple : en semaine après 17 h." />
        <CheckboxField name="urgent" label="C'est urgent (panne bloquante)" />
        <div>
          <SubmitButton>Envoyer ma demande</SubmitButton>
        </div>
      </ActionForm>
    </main>
  );
}
