import type { Metadata } from "next";
import Link from "next/link";
import { PageHeader, Section } from "@/components/admin/admin-ui";
import { CategoryFields } from "@/components/admin/category-fields";
import { categoryOptions } from "@/components/admin/category-options";
import { ActionForm, SubmitButton } from "@/components/admin/form-controls";
import { requirePermission } from "@/server/auth/session";
import { db } from "@/server/db/client";
import { listAdminCategories } from "@/server/modules/catalog/admin-categories";
import { createCategoryAction } from "./actions";

export const metadata: Metadata = { title: "Catégories", robots: { index: false } };

export default async function AdminCategoriesPage() {
  const user = await requirePermission("categories.manage", "/admin/categories");
  const rows = await listAdminCategories(db, user);
  const options = categoryOptions(rows);
  const byId = new Map(rows.map((row) => [row.id, row]));

  return (
    <div className="flex flex-col gap-6">
      <PageHeader title="Catégories" />
      <Section title="Arborescence">
        {options.length === 0 ? (
          <p className="text-ink-muted">Aucune catégorie.</p>
        ) : (
          <ul className="divide-y divide-line">
            {options.map((option) => {
              const row = byId.get(option.value)!;
              return (
                <li key={row.id} className="flex flex-wrap items-center justify-between gap-2 py-2">
                  <Link href={`/admin/categories/${row.id}`} className="text-brand-blue underline-offset-2 hover:underline">
                    {option.label}
                  </Link>
                  <span className="text-sm text-ink-muted">{row.productCount} produit(s)</span>
                </li>
              );
            })}
          </ul>
        )}
      </Section>
      <Section title="Nouvelle catégorie">
        <ActionForm action={createCategoryAction} resetOnSuccess>
          <CategoryFields parents={options} />
          <div>
            <SubmitButton>Créer la catégorie</SubmitButton>
          </div>
        </ActionForm>
      </Section>
    </div>
  );
}
