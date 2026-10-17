"use server";

import { revalidatePath } from "next/cache";
import { db } from "@/server/db/client";
import { deleteFaqItem, saveFaqItem, savePage } from "@/server/modules/content/admin";
import type { ActionState } from "@/lib/form-state";
import { checkbox, int, text } from "@/lib/form-data";
import { adminAction } from "../_lib/action";

export async function savePageAction(id: string | null, _state: ActionState, formData: FormData): Promise<ActionState> {
  return adminAction("/admin/contenu", async (actor) => {
    const { slug } = await savePage(db, actor, id, {
      slug: text(formData, "slug"),
      title: text(formData, "title"),
      body: text(formData, "body") ?? "",
      seoDescription: text(formData, "seoDescription"),
      isPublished: checkbox(formData, "isPublished"),
    });
    // Page publique (ancienne et nouvelle adresse), pied de page et plan du site : tout le site est rafraîchi.
    revalidatePath(`/pages/${slug}`);
    revalidatePath("/", "layout");
    return id ? "Page enregistrée." : "Page créée.";
  });
}

export async function saveFaqAction(id: string | null, _state: ActionState, formData: FormData): Promise<ActionState> {
  return adminAction("/admin/contenu", async (actor) => {
    await saveFaqItem(db, actor, id, {
      question: text(formData, "question"),
      answer: text(formData, "answer"),
      position: int(formData, "position") ?? 0,
      isPublished: checkbox(formData, "isPublished"),
    });
    revalidatePath("/faq");
    return id ? "Question enregistrée." : "Question ajoutée.";
  });
}

export async function deleteFaqAction(id: string): Promise<ActionState> {
  return adminAction("/admin/contenu", async (actor) => {
    await deleteFaqItem(db, actor, id);
    revalidatePath("/faq");
    return "Question supprimée.";
  });
}
