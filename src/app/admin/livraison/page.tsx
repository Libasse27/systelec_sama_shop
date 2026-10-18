import type { Metadata } from "next";
import { PageHeader, Section } from "@/components/admin/admin-ui";
import { ActionForm, CheckboxField, IntegerField, SelectField, SubmitButton, TextField } from "@/components/forms/form-controls";
import { COURIER_KIND_LABELS } from "@/lib/labels";
import { requirePermission } from "@/server/auth/session";
import { db } from "@/server/db/client";
import { listCourierAccounts, listCouriers, type CourierRow } from "@/server/modules/deliveries/queries";
import { listDeliverySettings } from "@/server/modules/orders/delivery-settings";
import { saveCourierAction, savePickupPointAction, saveZoneAction } from "./actions";

export const metadata: Metadata = { title: "Livraison et retrait", robots: { index: false } };

type Zone = Awaited<ReturnType<typeof listDeliverySettings>>["zones"][number];
type Point = Awaited<ReturnType<typeof listDeliverySettings>>["pickupPoints"][number];

function ZoneForm({ zone }: { zone?: Zone }) {
  return (
    <ActionForm action={saveZoneAction.bind(null, zone?.id ?? null)} resetOnSuccess={!zone}>
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
        <TextField name="name" label="Nom de la zone" defaultValue={zone?.name} />
        <IntegerField name="fee" label="Frais (FCFA)" defaultValue={zone?.fee} />
        <IntegerField name="freeAbove" label="Offerte dès (FCFA)" defaultValue={zone?.freeAbove} required={false} />
        <TextField name="leadTimeText" label="Délai" defaultValue={zone?.leadTimeText} required={false} hint="Ex. : sous 24 à 48 h" />
        <TextField name="description" label="Quartiers couverts" defaultValue={zone?.description} required={false} />
        <IntegerField name="position" label="Ordre" defaultValue={zone?.position ?? 0} required={false} />
      </div>
      <CheckboxField name="isActive" label="Proposée aux clients" defaultChecked={zone?.isActive ?? true} />
      <div>
        <SubmitButton>{zone ? "Enregistrer" : "Ajouter la zone"}</SubmitButton>
      </div>
    </ActionForm>
  );
}

function PickupForm({ point }: { point?: Point }) {
  return (
    <ActionForm action={savePickupPointAction.bind(null, point?.id ?? null)} resetOnSuccess={!point}>
      <div className="grid gap-3 sm:grid-cols-2">
        <TextField name="name" label="Nom" defaultValue={point?.name} />
        <TextField name="phone" label="Téléphone" defaultValue={point?.phone} required={false} />
        <TextField name="address" label="Adresse" defaultValue={point?.address} className="sm:col-span-2" />
        <TextField name="hours" label="Horaires" defaultValue={point?.hours} required={false} className="sm:col-span-2" />
      </div>
      <CheckboxField name="isActive" label="Proposé aux clients" defaultChecked={point?.isActive ?? true} />
      <div>
        <SubmitButton>{point ? "Enregistrer" : "Ajouter le point de retrait"}</SubmitButton>
      </div>
    </ActionForm>
  );
}

const courierKinds = Object.entries(COURIER_KIND_LABELS).map(([value, label]) => ({ value, label }));

/** Décision 5 : livreur interne relié à un compte (ses livraisons seulement) ou transporteur externe sans compte. */
function CourierForm({ courier, accounts }: { courier?: CourierRow; accounts: { id: string; label: string }[] }) {
  // Le compte déjà relié reste proposé même s'il n'a plus le rôle (pour pouvoir le changer).
  const accountOptions = courier?.userId && !accounts.some((account) => account.id === courier.userId)
    ? [...accounts, { id: courier.userId, label: courier.accountName ?? "Compte actuel" }]
    : accounts;
  return (
    <ActionForm action={saveCourierAction.bind(null, courier?.id ?? null)} resetOnSuccess={!courier}>
      <div className="grid gap-3 sm:grid-cols-2">
        <TextField name="name" label="Nom du livreur ou du transporteur" defaultValue={courier?.name} />
        <TextField name="phone" label="Téléphone" type="tel" defaultValue={courier?.phone} />
        <SelectField name="kind" label="Type" options={courierKinds} defaultValue={courier?.kind ?? "INTERNAL"} />
        <SelectField
          name="userId"
          label="Compte du livreur interne"
          options={accountOptions.map((account) => ({ value: account.id, label: account.label }))}
          defaultValue={courier?.userId}
          required={false}
          hint="Obligatoire pour un livreur interne : compte portant le rôle « Livreur ». Ignoré pour un transporteur externe."
        />
      </div>
      <CheckboxField name="isActive" label="Disponible pour les livraisons" defaultChecked={courier?.isActive ?? true} />
      <div>
        <SubmitButton>{courier ? "Enregistrer" : "Ajouter le livreur"}</SubmitButton>
      </div>
    </ActionForm>
  );
}

export default async function DeliverySettingsPage() {
  const user = await requirePermission("deliveries.manage", "/admin/livraison");
  const [{ zones, pickupPoints }, couriers, accounts] = await Promise.all([listDeliverySettings(db, user), listCouriers(db, user), listCourierAccounts(db, user)]);

  return (
    <div className="flex flex-col gap-6">
      <PageHeader title="Livraison et retrait" />
      <p className="-mt-4 text-sm text-ink-muted">
        Sans zone ni point de retrait actif, la commande en ligne reste fermée. Les commandes déjà passées gardent leurs frais.
      </p>
      <Section title="Zones de livraison">
        <div className="flex flex-col gap-4">
          {zones.map((zone) => (
            <details key={zone.id} className="rounded-lg border border-line p-3">
              <summary className="cursor-pointer font-medium">
                {zone.name} {!zone.isActive && <span className="text-sm text-ink-muted">(inactive)</span>}
              </summary>
              <div className="mt-3">
                <ZoneForm zone={zone} />
              </div>
            </details>
          ))}
          <h3 className="font-semibold">Nouvelle zone</h3>
          <ZoneForm />
        </div>
      </Section>
      <Section title="Livreurs">
        <div className="flex flex-col gap-4">
          {couriers.map((courier) => (
            <details key={courier.id} className="rounded-lg border border-line p-3">
              <summary className="cursor-pointer font-medium">
                {courier.name} · {COURIER_KIND_LABELS[courier.kind]}
                {courier.accountName && ` : ${courier.accountName}`} · {courier.activeDeliveries} livraison(s) en cours{" "}
                {!courier.isActive && <span className="text-sm text-ink-muted">(indisponible)</span>}
              </summary>
              <div className="mt-3">
                <CourierForm courier={courier} accounts={accounts} />
              </div>
            </details>
          ))}
          <h3 className="font-semibold">Nouveau livreur ou transporteur</h3>
          <CourierForm accounts={accounts} />
        </div>
      </Section>
      <Section title="Points de retrait">
        <div className="flex flex-col gap-4">
          {pickupPoints.map((point) => (
            <details key={point.id} className="rounded-lg border border-line p-3">
              <summary className="cursor-pointer font-medium">
                {point.name} {!point.isActive && <span className="text-sm text-ink-muted">(inactif)</span>}
              </summary>
              <div className="mt-3">
                <PickupForm point={point} />
              </div>
            </details>
          ))}
          <h3 className="font-semibold">Nouveau point de retrait</h3>
          <PickupForm />
        </div>
      </Section>
    </div>
  );
}
