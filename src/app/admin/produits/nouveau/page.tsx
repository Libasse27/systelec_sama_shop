import type { Metadata } from "next";
import { PageHeader, Section } from "@/components/admin/admin-ui";
import { categoryOptions } from "@/components/admin/category-options";
import { ActionForm, SubmitButton } from "@/components/admin/form-controls";
import { ProductFields, VariantFields } from "@/components/admin/product-fields";
import { requirePermission } from "@/server/auth/session";
import { db } from "@/server/db/client";
import { listAdminCategories } from "@/server/modules/catalog/admin-categories";
import { createProductAction } from "../actions";

export const metadata: Metadata = { title: "Nouveau produit", robots: { index: false } };

export default async function NewProductPage() {
  const user = await requirePermission("products.create", "/admin/produits/nouveau");
  const categories = categoryOptions(await listAdminCategories(db, user));

  return (
    <>
      <PageHeader title="Nouveau produit" />
      {categories.length === 0 ? (
        <p className="rounded-xl border border-line bg-surface p-6">Créez d&apos;abord une catégorie.</p>
      ) : (
        <ActionForm action={createProductAction}>
          <Section title="Fiche produit">
            <ProductFields categories={categories} />
          </Section>
          <Section title="Version par défaut (prix et référence)">
            <VariantFields prefix="variant." />
          </Section>
          <p className="text-sm text-ink-muted">
            Le produit est créé en brouillon, avec un stock à 0. Ajoutez images et stock, puis publiez-le.
          </p>
          <div>
            <SubmitButton>Créer le produit</SubmitButton>
          </div>
        </ActionForm>
      )}
    </>
  );
}
