import type { Metadata } from "next";
import { PageHeader, Section } from "@/components/admin/admin-ui";
import { ActionForm, CheckboxField, IntegerField, SelectField, SubmitButton, TextField } from "@/components/forms/form-controls";
import { requirePermission } from "@/server/auth/session";
import { db } from "@/server/db/client";
import { getAnnouncements, type Announcement } from "@/server/modules/announcements/admin";
import { toLocalDateTime } from "@/server/modules/announcements/form";
import { MAX_ANNOUNCEMENTS } from "@/server/modules/settings/schemas";
import { addAnnouncementAction, deleteAnnouncementAction, saveRotationAction, updateAnnouncementAction } from "./actions";

export const metadata: Metadata = { title: "Annonces", robots: { index: false } };

const KIND_OPTIONS = [
  { value: "ANNOUNCEMENT", label: "Annonce" },
  { value: "PROMOTION", label: "Publicité" },
] as const;

const LINK_HINT = "Facultatif. Chemin du site commençant par « / » (ex. /produits) ou adresse https://. Les autres adresses sont refusées.";

function AnnouncementForm({ item }: { item?: Announcement }) {
  return (
    <ActionForm action={item ? updateAnnouncementAction.bind(null, item.id) : addAnnouncementAction} resetOnSuccess={!item}>
      <div className="grid gap-3 sm:grid-cols-2">
        <TextField name="text" label="Texte" defaultValue={item?.text} hint="160 caractères au plus." className="sm:col-span-2" />
        <TextField name="href" label="Lien" defaultValue={item?.href} required={false} hint={LINK_HINT} />
        <SelectField name="kind" label="Type" options={KIND_OPTIONS} defaultValue={item?.kind ?? "ANNOUNCEMENT"} />
        <TextField name="startsAt" label="Début d'affichage" type="datetime-local" defaultValue={toLocalDateTime(item?.startsAt ?? null)} required={false} hint="Heure de Dakar. Vide : tout de suite." />
        <TextField name="endsAt" label="Fin d'affichage" type="datetime-local" defaultValue={toLocalDateTime(item?.endsAt ?? null)} required={false} hint="Heure de Dakar. Vide : sans fin." />
      </div>
      <CheckboxField name="isActive" label="Active (affichée sur le site)" defaultChecked={item?.isActive ?? true} />
      <div>
        <SubmitButton>{item ? "Enregistrer l'annonce" : "Ajouter l'annonce"}</SubmitButton>
      </div>
    </ActionForm>
  );
}

/** Bandeau d'annonces et de promotions au-dessus de l'en-tête : administrateur principal uniquement. */
export default async function AnnouncementsPage() {
  const user = await requirePermission("announcements.manage", "/admin/annonces");
  const { items, rotationSeconds, dropped } = await getAnnouncements(db, user);

  return (
    <div className="flex flex-col gap-6">
      <PageHeader title="Annonces" />
      <p className="-mt-4 text-sm text-ink-muted">
        Le bandeau s&apos;affiche tout en haut du site, au-dessus du menu. Il est masqué quand aucune annonce n&apos;est active. Chaque modification est inscrite au journal d&apos;audit.
      </p>

      {dropped > 0 && (
        <p role="alert" className="rounded-lg border border-amber-300 bg-amber-50 p-3 text-sm text-amber-900">
          La valeur enregistrée en base est partiellement invalide : {dropped} élément{dropped > 1 ? "s" : ""} non affichable{dropped > 1 ? "s" : ""} {dropped > 1 ? "sont écartés" : "est écarté"} de cette liste. Les annonces valides sont conservées ; le
          prochain enregistrement supprimera définitivement les éléments invalides (l&apos;ancienne valeur reste dans le journal d&apos;audit).
        </p>
      )}

      <Section title={`Annonces et publicités (${items.length}/${MAX_ANNOUNCEMENTS})`} id="annonces">
        {items.length === 0 && <p className="text-sm text-ink-muted">Aucune annonce pour le moment.</p>}
        <div className="flex flex-col gap-4">
          {items.map((item) => (
            <article key={item.id} className="flex flex-col gap-3 rounded-lg border border-line p-3">
              <AnnouncementForm item={item} />
              <ActionForm action={deleteAnnouncementAction.bind(null, item.id)}>
                <div>
                  <SubmitButton variant="danger" confirm="Supprimer cette annonce ?">
                    Supprimer
                  </SubmitButton>
                </div>
              </ActionForm>
            </article>
          ))}
        </div>
      </Section>

      {items.length < MAX_ANNOUNCEMENTS && (
        <Section title="Ajouter une annonce" id="ajouter">
          <AnnouncementForm />
        </Section>
      )}

      <Section title="Défilement" id="defilement">
        <ActionForm action={saveRotationAction}>
          <div className="grid gap-3 sm:grid-cols-2">
            <IntegerField name="rotationSeconds" label="Secondes par annonce" defaultValue={rotationSeconds} hint="De 4 à 20. Le défilement s'arrête au survol et pour les personnes qui réduisent les animations." />
          </div>
          <div>
            <SubmitButton>Enregistrer la durée</SubmitButton>
          </div>
        </ActionForm>
      </Section>
    </div>
  );
}
