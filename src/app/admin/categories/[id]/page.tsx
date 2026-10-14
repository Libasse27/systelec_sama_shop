import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { PageHeader, Section } from "@/components/admin/admin-ui";
import { CategoryFields } from "@/components/admin/category-fields";
import { categoryOptions } from "@/components/admin/category-options";
import { ActionForm, SubmitButton } from "@/components/forms/form-controls";
import { requirePermission } from "@/server/auth/session";
import { db } from "@/server/db/client";
import { getAdminCategory, listAdminCategories } from "@/server/modules/catalog/admin-categories";
import { deleteCategoryAction, updateCategoryAction } from "../actions";

export const metadata: Metadata = { title: "Catégorie", robots: { index: false } };

export default async function AdminCategoryPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const user = await requirePermission("categories.manage", `/admin/categories/${id}`);
  const category = await getAdminCategory(db, user, id);
  if (!category) notFound();
  const parents = categoryOptions(await listAdminCategories(db, user), { exclude: category.id });

  return (
    <div className="flex flex-col gap-6">
      <PageHeader title={category.name} />
      <Section title="Modifier">
        <ActionForm action={updateCategoryAction.bind(null, category.id)}>
          <CategoryFields category={category} parents={parents} />
          <div>
            <SubmitButton>Enregistrer</SubmitButton>
          </div>
        </ActionForm>
      </Section>
      <Section title="Supprimer">
        <p className="mb-3 text-sm text-ink-muted">
          Possible uniquement pour une catégorie vide (ni sous-catégorie, ni produit). Sinon, décochez « Visible sur la boutique ».
        </p>
        <ActionForm action={deleteCategoryAction.bind(null, category.id)} confirm="Supprimer définitivement cette catégorie ?">
          <div>
            <SubmitButton variant="danger">Supprimer la catégorie</SubmitButton>
          </div>
        </ActionForm>
      </Section>
    </div>
  );
}
