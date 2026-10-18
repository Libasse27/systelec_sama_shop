import type { Metadata } from "next";
import Link from "next/link";
import { PageHeader, Section } from "@/components/admin/admin-ui";
import { ActionForm, CheckboxField, FileField, GroupErrors, IntegerField, SubmitButton, TextField } from "@/components/forms/form-controls";
import { requirePermission } from "@/server/auth/session";
import { db } from "@/server/db/client";
import { getAllSettings } from "@/server/modules/settings/admin";
import { RETURN_PROCESSING_BUSINESS_HOURS } from "@/server/modules/returns/policy";
import {
  removeLogoAction,
  saveBusinessHoursAction,
  saveCommerceAction,
  saveCompanyAction,
  saveFeaturesAction,
  savePaymentsAction,
  saveTaxAction,
  uploadLogoAction,
} from "./actions";

export const metadata: Metadata = { title: "Paramètres", robots: { index: false } };

const PAYMENT_METHOD_LABELS = {
  CASH_ON_DELIVERY: "Espèces à la livraison",
  CASH_ON_PICKUP: "Espèces au retrait en boutique",
  CASH_AFTER_SERVICE: "Espèces après une prestation technique",
} as const;

const WEEKDAYS = [
  [1, "Lundi"],
  [2, "Mardi"],
  [3, "Mercredi"],
  [4, "Jeudi"],
  [5, "Vendredi"],
  [6, "Samedi"],
  [7, "Dimanche"],
] as const;

/** Paramètres administrables (D1 à D8, D13), validés et audités. Aucun moyen de paiement électronique. */
export default async function SettingsPage() {
  const user = await requirePermission("settings.manage", "/admin/parametres");
  const settings = await getAllSettings(db, user);
  const { company, commerce, payments, tax, features, businessHours } = settings;
  const [morning, afternoon] = businessHours.ranges;

  return (
    <div className="flex flex-col gap-6">
      <PageHeader title="Paramètres" />
      <p className="-mt-4 text-sm text-ink-muted">
        Chaque modification est inscrite au journal d&apos;audit (valeur avant et après). Zones de livraison et points de retrait (D4, D5) :{" "}
        <Link href="/admin/livraison" className="text-brand-blue underline">
          Livraison et retrait
        </Link>
        .
      </p>

      <Section title="Identité et mentions légales (D7)">
        <ActionForm action={saveCompanyAction}>
          <div className="grid gap-3 sm:grid-cols-2">
            <TextField name="companyName" label="Raison sociale" defaultValue={company.companyName} hint="Imprimée sur les reçus et factures." />
            <TextField name="shopName" label="Nom de la boutique" defaultValue={company.shopName} />
            <TextField name="ninea" label="NINEA" defaultValue={company.ninea} required={false} />
            <TextField name="rccm" label="RCCM" defaultValue={company.rccm} required={false} />
            <TextField name="phone" label="Téléphone" type="tel" defaultValue={company.phone} required={false} />
            <TextField name="whatsapp" label="WhatsApp" type="tel" defaultValue={company.whatsapp} required={false} />
            <TextField name="email" label="E-mail" type="email" defaultValue={company.email} required={false} />
            <TextField name="openingHours" label="Horaires" defaultValue={company.openingHours} required={false} />
            <TextField name="address" label="Adresse" defaultValue={company.address} required={false} className="sm:col-span-2" />
            <TextField name="socialLinks.facebook" label="Facebook" defaultValue={company.socialLinks.facebook} required={false} />
            <TextField name="socialLinks.instagram" label="Instagram" defaultValue={company.socialLinks.instagram} required={false} />
            <TextField name="socialLinks.linkedin" label="LinkedIn" defaultValue={company.socialLinks.linkedin} required={false} />
            <TextField name="socialLinks.tiktok" label="TikTok" defaultValue={company.socialLinks.tiktok} required={false} />
          </div>
          <div>
            <SubmitButton>Enregistrer l&apos;identité</SubmitButton>
          </div>
        </ActionForm>
      </Section>

      <Section title="Logo (D13)">
        <div className="flex flex-col gap-4">
          <p className="text-sm text-ink-muted">
            {company.logoUrl ? "Logo actuel :" : "Aucun logo : le logo typographique provisoire est affiché."} Le logo se téléverse uniquement : aucune adresse
            externe n&apos;est acceptée.
          </p>
          {company.logoUrl && (
            // eslint-disable-next-line @next/next/no-img-element -- logo téléversé, servi par /medias
            <img src={company.logoUrl} alt={`Logo actuel de ${company.shopName}`} className="h-12 w-auto self-start rounded bg-brand-navy p-1" />
          )}
          <ActionForm action={uploadLogoAction} resetOnSuccess>
            <FileField name="logo" label="Nouveau logo" accept="image/png,image/jpeg,image/webp" hint="PNG, JPEG ou WebP, 1 Mo au plus." />
            <div>
              <SubmitButton>Téléverser le logo</SubmitButton>
            </div>
          </ActionForm>
          <ActionForm action={removeLogoAction}>
            {company.logoUrl && (
              <div>
                <SubmitButton variant="danger" confirm="Retirer le logo et revenir au logo provisoire ?">
                  Retirer le logo
                </SubmitButton>
              </div>
            )}
          </ActionForm>
        </div>
      </Section>

      <Section title="Commande et paiement (D1, D2, D3)">
        <ActionForm action={saveCommerceAction}>
          <CheckboxField name="guestCheckoutEnabled" label="D1 — Commande sans compte (invité, téléphone obligatoire)" defaultChecked={commerce.guestCheckoutEnabled} />
          <CheckboxField name="partialPaymentEnabled" label="D2 — Paiement partiel en espèces (acompte)" defaultChecked={commerce.partialPaymentEnabled} />
          <IntegerField
            name="stockReservationHours"
            label="D3 — Durée de réservation du stock (heures)"
            defaultValue={commerce.stockReservationHours}
            hint="Sans confirmation passé ce délai, la commande est annulée et son stock libéré (1 à 720 h)."
          />
          <p className="text-xs text-ink-muted">Devise : franc CFA (XOF). Fuseau : Africa/Dakar. Non modifiables.</p>
          <div>
            <SubmitButton>Enregistrer les règles de commande</SubmitButton>
          </div>
        </ActionForm>
      </Section>

      <Section title="Heures ouvrables (retours)">
        <ActionForm action={saveBusinessHoursAction}>
          <p className="text-sm text-ink-muted">
            Le personnel dispose de {RETURN_PROCESSING_BUSINESS_HOURS} heures ouvrables pour commencer le traitement d&apos;un retour ; au-delà, les administrateurs
            sont alertés une fois et la demande reste ouverte. Heure de Dakar. Les jours fériés ne sont pas déduits.
          </p>
          <fieldset className="flex flex-wrap gap-x-4 gap-y-2">
            <legend className="mb-1 text-sm font-medium">Jours ouvrables</legend>
            {WEEKDAYS.map(([day, label]) => (
              <CheckboxField key={day} name={`day-${day}`} label={label} defaultChecked={businessHours.days.includes(day)} />
            ))}
          </fieldset>
          <GroupErrors name="days" />
          <div className="grid gap-3 sm:grid-cols-4">
            <TextField name="ranges.0.start" label="Ouverture" type="time" defaultValue={morning?.start} />
            <TextField name="ranges.0.end" label="Fermeture" type="time" defaultValue={morning?.end} />
            <TextField name="ranges.1.start" label="Réouverture" type="time" required={false} defaultValue={afternoon?.start} hint="Après une pause de mi-journée." />
            <TextField name="ranges.1.end" label="Fermeture du soir" type="time" required={false} defaultValue={afternoon?.end} />
          </div>
          <GroupErrors name="ranges" exact />
          <div>
            <SubmitButton>Enregistrer les heures ouvrables</SubmitButton>
          </div>
        </ActionForm>
      </Section>

      <Section title="Moyens de règlement">
        <ActionForm action={savePaymentsAction}>
          <p className="text-sm text-ink-muted">Espèces uniquement : aucun paiement électronique n&apos;existe dans l&apos;application.</p>
          {Object.entries(PAYMENT_METHOD_LABELS).map(([method, label]) => (
            <CheckboxField key={method} name={method} label={label} defaultChecked={payments.enabledMethods.includes(method as keyof typeof PAYMENT_METHOD_LABELS)} />
          ))}
          <div>
            <SubmitButton>Enregistrer les moyens de règlement</SubmitButton>
          </div>
        </ActionForm>
      </Section>

      <Section title="TVA (D6)">
        <ActionForm action={saveTaxAction}>
          <p className="text-sm text-ink-muted">Les prix sont saisis et affichés TTC. Activez le détail une fois validé avec votre comptable.</p>
          <CheckboxField name="vatDetailEnabled" label="Afficher la TVA incluse sur les factures" defaultChecked={tax.vatDetailEnabled} />
          <IntegerField name="vatRate" label="Taux de TVA (%)" defaultValue={tax.vatRate} />
          <div>
            <SubmitButton>Enregistrer la TVA</SubmitButton>
          </div>
        </ActionForm>
      </Section>

      <Section title="Fonctions (D8)">
        <ActionForm action={saveFeaturesAction}>
          <CheckboxField name="reviewsEnabled" label="Avis clients (achats vérifiés et modérés)" defaultChecked={features.reviewsEnabled} />
          <p className="text-xs text-ink-muted">Le module d&apos;avis n&apos;est pas encore livré : ce réglage est conservé et ne publie rien pour l&apos;instant.</p>
          <div>
            <SubmitButton>Enregistrer</SubmitButton>
          </div>
        </ActionForm>
      </Section>
    </div>
  );
}
