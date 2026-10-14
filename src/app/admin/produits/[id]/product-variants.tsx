import Link from "next/link";
import { Section } from "@/components/admin/admin-ui";
import { ActionForm, SubmitButton } from "@/components/admin/form-controls";
import { VariantFields } from "@/components/admin/product-fields";
import type { AdminProduct } from "@/server/modules/catalog/admin-queries";
import { addVariantAction, setDefaultVariantAction, updateVariantAction } from "../actions";

/** Versions du produit : modification, version par défaut, stock, ajout. */
export function ProductVariants({ product, canSeeStock }: { product: AdminProduct; canSeeStock: boolean }) {
  return (
    <Section title="Versions, prix et promotions">
      <div className="flex flex-col gap-6">
        {product.variants.map((variant) => (
          <article key={variant.id} className="rounded-lg border border-line p-4">
            <header className="mb-3 flex flex-wrap items-center justify-between gap-2">
              <h3 className="font-semibold">
                {variant.name} <span className="font-mono text-sm text-ink-muted">{variant.sku}</span>
                {variant.isDefault && <span className="ml-2 rounded-md bg-surface-muted px-2 py-0.5 text-xs">par défaut</span>}
                {!variant.isActive && <span className="ml-2 rounded-md bg-slate-200 px-2 py-0.5 text-xs">hors vente</span>}
              </h3>
              <p className="text-sm">
                Stock : <strong>{variant.onHand}</strong> (réservé {variant.reserved}, disponible {variant.onHand - variant.reserved})
                {canSeeStock && (
                  <>
                    {" · "}
                    <Link href={`/admin/stock/${variant.id}`} className="text-brand-blue underline">
                      Gérer le stock
                    </Link>
                  </>
                )}
              </p>
            </header>
            <ActionForm action={updateVariantAction.bind(null, product.id, variant.id)}>
              <VariantFields variant={variant} showActive />
              <div className="flex flex-wrap gap-2">
                <SubmitButton>Enregistrer la version</SubmitButton>
              </div>
            </ActionForm>
            {!variant.isDefault && variant.isActive && (
              <ActionForm action={setDefaultVariantAction.bind(null, product.id, variant.id)} className="mt-2">
                <div>
                  <SubmitButton variant="secondary">Définir par défaut</SubmitButton>
                </div>
              </ActionForm>
            )}
          </article>
        ))}

        <details className="rounded-lg border border-dashed border-line p-4">
          <summary className="cursor-pointer font-semibold">Ajouter une version</summary>
          <ActionForm action={addVariantAction.bind(null, product.id)} resetOnSuccess className="mt-4">
            <VariantFields />
            <div>
              <SubmitButton>Ajouter la version</SubmitButton>
            </div>
          </ActionForm>
        </details>
      </div>
    </Section>
  );
}
