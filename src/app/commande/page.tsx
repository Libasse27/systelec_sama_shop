import type { Metadata } from "next";
import Link from "next/link";
import { randomUUID } from "node:crypto";
import { redirect } from "next/navigation";
import { ActionForm, SubmitButton, TextAreaField, TextField } from "@/components/forms/form-controls";
import { formatFcfa } from "@/lib/money";
import { getCurrentUser } from "@/server/auth/session";
import { db } from "@/server/db/client";
import { getCartView } from "@/server/modules/cart/service";
import { readCartOwner } from "@/server/modules/cart/session";
import { getCheckoutOptions } from "@/server/modules/orders/queries";
import { getSetting } from "@/server/modules/settings/service";
import { placeOrderAction } from "./actions";

export const metadata: Metadata = { title: "Commande", robots: { index: false } };

const radioClass = "flex cursor-pointer items-start gap-3 rounded-lg border border-line p-3 has-[:checked]:border-brand-blue has-[:checked]:bg-blue-50";

export default async function CheckoutPage() {
  const owner = await readCartOwner();
  const cart = owner ? await getCartView(db, owner) : null;
  if (!cart || !cart.canCheckout) redirect("/panier");
  const [user, options, commerce] = await Promise.all([getCurrentUser(), getCheckoutOptions(db), getSetting("commerce")]);

  if (!user && !commerce.guestCheckoutEnabled) {
    return (
      <main className="mx-auto max-w-2xl px-4 py-8">
        <h1 className="text-2xl font-bold">Commande</h1>
        <p className="mt-4">
          Pour commander,{" "}
          <Link href="/connexion?suivant=/commande" className="text-brand-blue underline">
            connectez-vous
          </Link>{" "}
          ou{" "}
          <Link href="/inscription" className="text-brand-blue underline">
            créez un compte
          </Link>
          .
        </p>
      </main>
    );
  }
  if (options.zones.length === 0 && options.pickupPoints.length === 0) {
    return (
      <main className="mx-auto max-w-2xl px-4 py-8">
        <h1 className="text-2xl font-bold">Commande</h1>
        <p className="mt-4">
          La commande en ligne n&apos;est pas encore ouverte (zones de livraison en cours de configuration).{" "}
          <Link href="/contact" className="text-brand-blue underline">
            Contactez-nous
          </Link>{" "}
          pour réserver vos articles.
        </p>
      </main>
    );
  }

  return (
    <main className="mx-auto grid max-w-5xl gap-6 px-4 py-8 lg:grid-cols-[1fr_20rem]">
      <div>
        <h1 className="text-2xl font-bold">Commande</h1>
        {!user && (
          <p className="mt-2 text-sm text-ink-muted">
            Vous commandez sans compte.{" "}
            <Link href="/connexion?suivant=/commande" className="text-brand-blue underline">
              Se connecter
            </Link>{" "}
            pour retrouver vos commandes dans votre espace.
          </p>
        )}
        <ActionForm action={placeOrderAction} className="mt-6">
          {/* Clé d'idempotence : un double envoi de CE formulaire ne crée qu'une commande. */}
          <input type="hidden" name="idempotencyKey" value={randomUUID()} />
          <input type="hidden" name="expectedSubtotal" value={cart.subtotal} />

          <fieldset className="flex flex-col gap-4 rounded-xl border border-line bg-surface p-4">
            <legend className="px-1 font-semibold">Vos coordonnées</legend>
            <TextField name="name" label="Nom complet" defaultValue={user?.name} />
            <TextField name="phone" label="Téléphone" hint="Nous vous appelons pour confirmer la commande." />
            <TextField name="email" label="E-mail" defaultValue={user?.email} required={false} hint="Pour recevoir la confirmation par e-mail." />
          </fieldset>

          <fieldset className="flex flex-col gap-2 rounded-xl border border-line bg-surface p-4">
            <legend className="px-1 font-semibold">Livraison ou retrait</legend>
            {options.zones.map((zone, index) => (
              <label key={zone.id} className={radioClass}>
                <input type="radio" name="remise" value={`DELIVERY:${zone.id}`} defaultChecked={index === 0} className="mt-1" />
                <span>
                  <span className="font-medium">Livraison — {zone.name}</span> : {zone.fee === 0 ? "gratuite" : formatFcfa(zone.fee)}
                  {zone.freeAbove !== null && zone.fee > 0 && <span className="text-sm text-ink-muted"> (offerte dès {formatFcfa(zone.freeAbove)})</span>}
                  {zone.leadTimeText && <span className="block text-sm text-ink-muted">{zone.leadTimeText}</span>}
                </span>
              </label>
            ))}
            {options.pickupPoints.map((point, index) => (
              <label key={point.id} className={radioClass}>
                <input type="radio" name="remise" value={`PICKUP:${point.id}`} defaultChecked={options.zones.length === 0 && index === 0} className="mt-1" />
                <span>
                  <span className="font-medium">Retrait gratuit — {point.name}</span>
                  <span className="block text-sm text-ink-muted">
                    {point.address}
                    {point.hours && ` · ${point.hours}`}
                  </span>
                </span>
              </label>
            ))}
          </fieldset>

          {options.zones.length > 0 && (
            <fieldset className="grid gap-4 rounded-xl border border-line bg-surface p-4 sm:grid-cols-2">
              <legend className="px-1 font-semibold">Adresse de livraison</legend>
              <p className="text-sm text-ink-muted sm:col-span-2">À remplir pour une livraison (inutile pour un retrait).</p>
              <TextField name="line1" label="Adresse" required={false} className="sm:col-span-2" />
              <TextField name="district" label="Quartier" required={false} />
              <TextField name="city" label="Ville" required={false} defaultValue="Dakar" />
              <TextField name="landmark" label="Point de repère" required={false} className="sm:col-span-2" hint="Ex. : en face de la mosquée, près de la pharmacie…" />
            </fieldset>
          )}

          <TextAreaField name="notes" label="Remarques" required={false} rows={3} />
          <p className="rounded-lg bg-brand-navy p-3 text-sm text-white">
            Paiement <strong>en espèces uniquement</strong>, à la livraison ou au retrait. Aucun paiement en ligne.
          </p>
          <div>
            <SubmitButton>Confirmer la commande</SubmitButton>
          </div>
        </ActionForm>
      </div>

      <aside aria-labelledby="recapitulatif" className="h-fit rounded-xl border border-line bg-surface p-4 lg:sticky lg:top-4">
        <h2 id="recapitulatif" className="font-semibold">
          Récapitulatif
        </h2>
        <ul className="mt-3 flex flex-col gap-2 text-sm">
          {cart.lines.map((line) => (
            <li key={line.variantId} className="flex justify-between gap-2">
              <span>
                {line.quantity} × {line.productName}
              </span>
              <span className="whitespace-nowrap">{formatFcfa(line.lineTotal)}</span>
            </li>
          ))}
        </ul>
        <p className="mt-3 flex justify-between border-t border-line pt-3 font-semibold">
          <span>Sous-total</span>
          <span>{formatFcfa(cart.subtotal)}</span>
        </p>
        <p className="mt-1 text-xs text-ink-muted">+ frais de la zone choisie (le total exact figure sur la confirmation).</p>
      </aside>
    </main>
  );
}
