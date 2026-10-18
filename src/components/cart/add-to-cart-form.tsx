import Link from "next/link";
import { addToCartAction } from "@/app/panier/actions";
import { ActionForm, IntegerField, SelectField, SubmitButton } from "@/components/forms/form-controls";
import { formatFcfa } from "@/lib/money";

interface VariantOption {
  sku: string;
  name: string;
  price: number;
  available: number;
}

/** Ajout au panier depuis la fiche produit (version, quantité). Le stock est revérifié par le serveur. */
export function AddToCartForm({ variants }: { variants: readonly VariantOption[] }) {
  const inStock = variants.filter((variant) => variant.available > 0);
  if (inStock.length === 0) {
    return <p className="rounded-lg bg-surface-muted p-3 text-sm">Produit épuisé pour le moment.</p>;
  }
  return (
    <ActionForm action={addToCartAction} className="gap-3 rounded-xl border border-line bg-surface p-4">
      {inStock.length > 1 ? (
        <SelectField
          name="sku"
          label="Version"
          options={inStock.map((variant) => ({ value: variant.sku, label: `${variant.name} — ${formatFcfa(variant.price)}` }))}
        />
      ) : (
        <input type="hidden" name="sku" value={inStock[0]!.sku} />
      )}
      <IntegerField name="quantity" label="Quantité" defaultValue={1} className="max-w-32" />
      <div className="flex flex-wrap items-center gap-3">
        <SubmitButton>Ajouter au panier</SubmitButton>
        <Link href="/panier" className="text-sm text-brand-blue underline">
          Voir le panier
        </Link>
      </div>
    </ActionForm>
  );
}
