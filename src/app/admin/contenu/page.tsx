import type { Metadata } from "next";
import { PageHeader, Section } from "@/components/admin/admin-ui";
import { ActionForm, CheckboxField, IntegerField, SubmitButton, TextAreaField, TextField } from "@/components/forms/form-controls";
import { formatDateTime } from "@/lib/dates";
import { requirePermission } from "@/server/auth/session";
import { db } from "@/server/db/client";
import { listAdminFaq, listAdminPages, MAX_PAGE_BODY, type AdminPage } from "@/server/modules/content/admin";
import { deleteFaqAction, saveFaqAction, savePageAction } from "./actions";

export const metadata: Metadata = { title: "Contenu", robots: { index: false } };

type FaqItem = Awaited<ReturnType<typeof listAdminFaq>>[number];

function PageForm({ page }: { page?: AdminPage }) {
  return (
    <ActionForm action={savePageAction.bind(null, page?.id ?? null)} resetOnSuccess={!page}>
      <div className="grid gap-3 sm:grid-cols-2">
        <TextField name="title" label="Titre" defaultValue={page?.title} />
        <TextField name="slug" label="Adresse (/pages/…)" defaultValue={page?.slug} hint="Minuscules, chiffres et tirets." />
      </div>
      <TextAreaField
        name="body"
        label="Texte"
        defaultValue={page?.body}
        rows={10}
        required={false}
        hint={`Texte brut : séparez les paragraphes par une ligne vide. ${MAX_PAGE_BODY.toLocaleString("fr-FR")} caractères au plus.`}
      />
      <TextField name="seoDescription" label="Description pour les moteurs de recherche" defaultValue={page?.seoDescription} required={false} />
      <CheckboxField name="isPublished" label="Publiée (visible par tous)" defaultChecked={page?.isPublished ?? false} />
      <div>
        <SubmitButton>{page ? "Enregistrer la page" : "Créer la page"}</SubmitButton>
      </div>
    </ActionForm>
  );
}

function FaqForm({ item }: { item?: FaqItem }) {
  return (
    <ActionForm action={saveFaqAction.bind(null, item?.id ?? null)} resetOnSuccess={!item}>
      <TextField name="question" label="Question" defaultValue={item?.question} />
      <TextAreaField name="answer" label="Réponse" defaultValue={item?.answer} rows={3} />
      <div className="grid gap-3 sm:grid-cols-2">
        <IntegerField name="position" label="Ordre" defaultValue={item?.position ?? 0} required={false} />
      </div>
      <CheckboxField name="isPublished" label="Publiée" defaultChecked={item?.isPublished ?? true} />
      <div>
        <SubmitButton>{item ? "Enregistrer" : "Ajouter la question"}</SubmitButton>
      </div>
    </ActionForm>
  );
}

/** Pages d'information (CGV, livraison, garantie…) et FAQ. Le logo et l'identité sont dans « Paramètres ». */
export default async function ContentPage() {
  const user = await requirePermission("content.manage", "/admin/contenu");
  const [pages, faq] = await Promise.all([listAdminPages(db, user), listAdminFaq(db, user)]);

  return (
    <div className="flex flex-col gap-6">
      <PageHeader title="Contenu" />
      <p className="-mt-4 text-sm text-ink-muted">
        Aucun texte n&apos;est inventé : les pages légales restent en brouillon tant que leur texte n&apos;est pas validé. Le logo se change dans « Paramètres ».
      </p>
      <Section title="Pages d'information">
        <div className="flex flex-col gap-4">
          {pages.map((page) => (
            <details key={page.id} className="rounded-lg border border-line p-3">
              <summary className="cursor-pointer font-medium">
                {page.title} <span className="text-sm text-ink-muted">({page.isPublished ? "publiée" : "brouillon"} · modifiée le {formatDateTime(page.updatedAt)})</span>
              </summary>
              <div className="mt-3 flex flex-col gap-2">
                {page.isPublished && (
                  <a href={`/pages/${page.slug}`} target="_blank" rel="noopener" className="text-sm text-brand-blue underline">
                    Voir la page publiée
                  </a>
                )}
                <PageForm page={page} />
              </div>
            </details>
          ))}
          <h3 className="font-semibold">Nouvelle page</h3>
          <PageForm />
        </div>
      </Section>
      <Section title="Questions fréquentes">
        <div className="flex flex-col gap-4">
          {faq.map((item) => (
            <details key={item.id} className="rounded-lg border border-line p-3">
              <summary className="cursor-pointer font-medium">
                {item.question} {!item.isPublished && <span className="text-sm text-ink-muted">(masquée)</span>}
              </summary>
              <div className="mt-3 flex flex-col gap-3">
                <FaqForm item={item} />
                <ActionForm action={deleteFaqAction.bind(null, item.id)}>
                  <div>
                    <SubmitButton variant="danger" confirm="Supprimer cette question ?">
                      Supprimer
                    </SubmitButton>
                  </div>
                </ActionForm>
              </div>
            </details>
          ))}
          <h3 className="font-semibold">Nouvelle question</h3>
          <FaqForm />
        </div>
      </Section>
    </div>
  );
}
