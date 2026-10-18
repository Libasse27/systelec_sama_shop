import { toLabelValueText } from "@/lib/form-data";
import { CONDITION_OPTIONS } from "@/lib/labels";
import type { AdminProduct, AdminVariant } from "@/server/modules/catalog/admin-queries";
import { CheckboxField, IntegerField, SelectField, TextAreaField, TextField } from "@/components/forms/form-controls";

const SPECS_HINT = "Une caractéristique par ligne, au format « Libellé : valeur ».";

/** Champs de la fiche produit (création et modification). */
export function ProductFields({
  product,
  categories,
}: {
  product?: AdminProduct;
  categories: readonly { value: string; label: string }[];
}) {
  return (
    <div className="grid gap-4 sm:grid-cols-2">
      <TextField name="name" label="Nom du produit" defaultValue={product?.name} className="sm:col-span-2" />
      <SelectField name="categoryId" label="Catégorie" options={categories} defaultValue={product?.categoryId} />
      <TextField name="brandName" label="Marque" defaultValue={product?.brandName} required={false} hint="Créée automatiquement si elle n'existe pas." />
      <TextField name="model" label="Modèle" defaultValue={product?.model} required={false} />
      <SelectField name="condition" label="État" options={CONDITION_OPTIONS} defaultValue={product?.condition ?? "NEW"} />
      <TextAreaField name="shortDescription" label="Description courte" defaultValue={product?.shortDescription} rows={2} className="sm:col-span-2" hint="Affichée dans les listes (300 caractères maximum)." />
      <TextAreaField name="description" label="Description détaillée" defaultValue={product?.description} rows={8} className="sm:col-span-2" />
      <TextAreaField name="specs" label="Caractéristiques techniques" defaultValue={product ? toLabelValueText(product.specs) : ""} required={false} rows={5} hint={SPECS_HINT} className="sm:col-span-2" />
      <IntegerField name="warrantyMonths" label="Garantie (mois)" defaultValue={product?.warrantyMonths} required={false} />
      <TextField name="warrantyText" label="Conditions de garantie" defaultValue={product?.warrantyText} required={false} />
      <IntegerField name="weightGrams" label="Poids (grammes)" defaultValue={product?.weightGrams} required={false} />
      <TextField name="dimensions" label="Dimensions" defaultValue={product?.dimensions} required={false} hint="Ex. 30 × 20 × 5 cm" />
      <TextField name="slug" label="Identifiant d'URL" defaultValue={product?.slug} required={false} hint="Laissé vide : dérivé du nom. Le modifier change l'adresse de la page." />
      <div className="flex items-end pb-2">
        <CheckboxField name="isFeatured" label="Mettre en avant sur l'accueil" defaultChecked={product?.isFeatured} />
      </div>
      <TextField name="seoTitle" label="Titre pour les moteurs de recherche" defaultValue={product?.seoTitle} required={false} />
      <TextField name="seoDescription" label="Description pour les moteurs de recherche" defaultValue={product?.seoDescription} required={false} />
    </div>
  );
}

/** Champs d'une version (variante) : référence, prix, prix barré (promotion), prix d'achat. */
export function VariantFields({ variant, prefix = "", showActive = false }: { variant?: AdminVariant; prefix?: string; showActive?: boolean }) {
  const attributes = variant ? toLabelValueText(Object.entries(variant.attributes).map(([label, value]) => ({ label, value }))) : "";
  return (
    <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
      <TextField name={`${prefix}name`} label="Nom de la version" defaultValue={variant?.name ?? (prefix ? "Standard" : "")} />
      <TextField name={`${prefix}sku`} label="Référence (SKU)" defaultValue={variant?.sku} hint="Unique ; lettres, chiffres, point, tiret." />
      <TextField name={`${prefix}barcode`} label="Code-barres" defaultValue={variant?.barcode} required={false} />
      <IntegerField name={`${prefix}price`} label="Prix de vente TTC (FCFA)" defaultValue={variant?.price} />
      <IntegerField name={`${prefix}compareAtPrice`} label="Prix barré (FCFA)" defaultValue={variant?.compareAtPrice} required={false} hint="Promotion : ancien prix affiché barré, supérieur au prix de vente." />
      <IntegerField name={`${prefix}costPrice`} label="Prix d'achat (FCFA)" defaultValue={variant?.costPrice} required={false} hint="Interne, jamais affiché aux clients." />
      <TextAreaField name={`${prefix}attributes`} label="Attributs" defaultValue={attributes} required={false} rows={2} hint="Ex. « Capacité : 1 To », un par ligne." className="sm:col-span-2" />
      {showActive && (
        <div className="flex items-end pb-2">
          <CheckboxField name={`${prefix}isActive`} label="Version en vente" defaultChecked={variant?.isActive ?? true} />
        </div>
      )}
    </div>
  );
}
