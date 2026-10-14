"use server";

import { redirect } from "next/navigation";
import { db } from "@/server/db/client";
import { createCategory, deleteCategory, updateCategory } from "@/server/modules/catalog/admin-categories";
import { adminAction } from "../_lib/action";
import { checkbox, int, text } from "../_lib/form-data";
import type { ActionState } from "../_lib/form-state";

function categoryFields(formData: FormData) {
  return {
    name: text(formData, "name"),
    slug: text(formData, "slug"),
    parentId: text(formData, "parentId"),
    description: text(formData, "description"),
    position: int(formData, "position") ?? 0,
    isActive: checkbox(formData, "isActive"),
    seoTitle: text(formData, "seoTitle"),
    seoDescription: text(formData, "seoDescription"),
  };
}

export async function createCategoryAction(_state: ActionState, formData: FormData): Promise<ActionState> {
  return adminAction("/admin/categories", async (actor) => {
    await createCategory(db, actor, categoryFields(formData));
    return "Catégorie créée.";
  });
}

export async function updateCategoryAction(id: string, _state: ActionState, formData: FormData): Promise<ActionState> {
  return adminAction(`/admin/categories/${id}`, async (actor) => {
    await updateCategory(db, actor, id, categoryFields(formData));
    return "Catégorie enregistrée.";
  });
}

export async function deleteCategoryAction(id: string): Promise<ActionState> {
  const state = await adminAction(`/admin/categories/${id}`, async (actor) => {
    await deleteCategory(db, actor, id);
  });
  if (state.error) return state;
  redirect("/admin/categories");
}
