import type { Metadata } from "next";
import Link from "next/link";
import { ProductImage } from "@/components/catalog/product-card";
import { ActionForm, IntegerField, SubmitButton } from "@/components/forms/form-controls";
import { formatFcfa } from "@/lib/money";
import { db } from "@/server/db/client";
import { getCartView, type CartLine } from "@/server/modules/cart/service";
import { readCartOwner } from "@/server/modules/cart/session";
import { removeCartLineAction, updateCartLineAction } from "./actions";

export const metadata: Metadata = { title: "Panier", robots: { index: false } };

function LineIssue({ line }: { line: CartLine }) {
  if (line.issue === "UNAVAILABLE") return <p className="text-sm font-medium text-red-700">Ce produit n&apos;est plus disponible : retirez-le.</p>;
  if (line.issue === "INSUFFICIENT_STOCK") {
    return (
      <p className="text-sm font-medium text-red-700">
        {line.available === 0 ? "Épuisé : retirez-le." : `Seulement ${line.available} disponible(s) : réduisez la quantité.`}
      </p>
    );
  }
  return null;
}

export default async function CartPage() {
  const owner = await readCartOwner();
  const cart = owner ? await getCartView(db, owner) : null;

  return (
    <main className="mx-auto max-w-4xl px-4 py-8">
      <h1 className="text-2xl font-bold">Panier</h1>
      {!cart || cart.lines.length === 0 ? (
        <div className="mt-6 rounded-xl border border-line bg-surface p-6 text-center">
          <p>Votre panier est vide.</p>
          <Link href="/recherche" className="mt-3 inline-block text-brand-blue underline">
            Parcourir le catalogue
          </Link>
        </div>
      ) : (
        <>
          <ul className="mt-6 flex flex-col gap-4">
            {cart.lines.map((line) => (
              <li key={line.variantId} className="grid gap-4 rounded-xl border border-line bg-surface p-4 sm:grid-cols-[6rem_1fr_auto]">
                <div className="w-24">
                  <ProductImage image={line.image} />
                </div>
                <div className="flex flex-col gap-1">
                  <Link href={`/produits/${line.productSlug}`} className="font-semibold hover:underline">
                    {line.productName}
                  </Link>
                  <p className="text-sm text-ink-muted">
                    {line.variantName} · {formatFcfa(line.unitPrice)} l&apos;unité
                  </p>
                  <LineIssue line={line} />
                  <div className="mt-2 flex flex-wrap items-end gap-2">
                    <ActionForm action={updateCartLineAction.bind(null, line.variantId)} className="flex-row flex-wrap items-end gap-2">
                      <IntegerField name="quantity" label="Quantité" defaultValue={line.quantity} className="w-24" />
                      <SubmitButton variant="secondary">Mettre à jour</SubmitButton>
                    </ActionForm>
                    <ActionForm action={removeCartLineAction.bind(null, line.variantId)}>
                      <SubmitButton variant="danger">Retirer</SubmitButton>
                    </ActionForm>
                  </div>
                </div>
                <p className="font-semibold sm:text-right">{formatFcfa(line.lineTotal)}</p>
              </li>
            ))}
          </ul>
          <div className="mt-6 flex flex-col items-end gap-3 rounded-xl border border-line bg-surface p-4">
            <p className="text-lg">
              Sous-total : <strong>{formatFcfa(cart.subtotal)}</strong>
            </p>
            <p className="text-sm text-ink-muted">Frais de livraison calculés à l&apos;étape suivante. Paiement en espèces uniquement.</p>
            {cart.canCheckout ? (
              <Link href="/commande" className="rounded-lg bg-brand-blue px-5 py-2.5 font-semibold text-white hover:bg-brand-blue-dark">
                Passer la commande
              </Link>
            ) : (
              <p className="text-sm font-medium text-red-700">Ajustez les articles signalés pour pouvoir commander.</p>
            )}
          </div>
        </>
      )}
    </main>
  );
}
