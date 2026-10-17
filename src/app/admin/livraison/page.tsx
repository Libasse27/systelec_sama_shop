import type { Metadata } from "next";
import { PageHeader, Section } from "@/components/admin/admin-ui";
import { ActionForm, CheckboxField, IntegerField, SubmitButton, TextField } from "@/components/forms/form-controls";
import { requirePermission } from "@/server/auth/session";
import { db } from "@/server/db/client";
import { listCouriers, type CourierRow } from "@/server/modules/deliveries/queries";
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

function CourierForm({ courier }: { courier?: CourierRow }) {
  return (
    <ActionForm action={saveCourierAction.bind(null, courier?.id ?? null)} resetOnSuccess={!courier}>
      <div className="grid gap-3 sm:grid-cols-2">
        <TextField name="name" label="Nom du livreur" defaultValue={courier?.name} />
        <TextField name="phone" label="Téléphone" type="tel" defaultValue={courier?.phone} />
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
  const [{ zones, pickupPoints }, couriers] = await Promise.all([listDeliverySettings(db, user), listCouriers(db, user)]);

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
                {courier.name} · {courier.activeDeliveries} livraison(s) en cours {!courier.isActive && <span className="text-sm text-ink-muted">(indisponible)</span>}
              </summary>
              <div className="mt-3">
                <CourierForm courier={courier} />
              </div>
            </details>
          ))}
          <h3 className="font-semibold">Nouveau livreur</h3>
          <CourierForm />
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
