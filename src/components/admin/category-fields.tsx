import type { AdminCategoryRow } from "@/server/modules/catalog/admin-categories";
import { CheckboxField, IntegerField, SelectField, TextAreaField, TextField } from "./form-controls";

export interface CategoryDefaults extends Omit<AdminCategoryRow, "productCount"> {
  description: string | null;
  seoTitle: string | null;
  seoDescription: string | null;
}

export function CategoryFields({ category, parents }: { category?: CategoryDefaults; parents: readonly { value: string; label: string }[] }) {
  return (
    <div className="grid gap-4 sm:grid-cols-2">
      <TextField name="name" label="Nom" defaultValue={category?.name} />
      <SelectField name="parentId" label="Catégorie parente" options={parents} defaultValue={category?.parentId} required={false} hint="Vide : famille principale." />
      <TextField name="slug" label="Identifiant d'URL" defaultValue={category?.slug} required={false} hint="Laissé vide : dérivé du nom." />
      <IntegerField name="position" label="Ordre d'affichage" defaultValue={category?.position ?? 0} required={false} />
      <TextAreaField name="description" label="Description" defaultValue={category?.description} required={false} rows={3} className="sm:col-span-2" />
      <TextField name="seoTitle" label="Titre pour les moteurs de recherche" defaultValue={category?.seoTitle} required={false} />
      <TextField name="seoDescription" label="Description pour les moteurs de recherche" defaultValue={category?.seoDescription} required={false} />
      <CheckboxField name="isActive" label="Visible sur la boutique" defaultChecked={category?.isActive ?? true} />
    </div>
  );
}
