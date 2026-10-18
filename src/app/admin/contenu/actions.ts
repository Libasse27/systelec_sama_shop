"use server";

import { revalidatePath } from "next/cache";
import { db } from "@/server/db/client";
import { deleteFaqItem, saveFaqItem, savePage } from "@/server/modules/content/admin";
import { createPartner, deletePartner, updatePartner } from "@/server/modules/partners/admin";
import { ValidationError } from "@/server/errors";
import { MAX_LOGO_BYTES } from "@/server/storage/logo-upload";
import { getStorage } from "@/server/storage/storage";
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

// ─── Partenaires (décision 4 : logos téléversés uniquement) ─────────────────

const partnerInput = (formData: FormData) => ({
  name: text(formData, "name"),
  websiteUrl: text(formData, "websiteUrl"),
  isActive: checkbox(formData, "isActive"),
  position: int(formData, "position") ?? 0,
});

async function logoBytes(formData: FormData): Promise<Uint8Array> {
  const file = formData.get("logo");
  if (!(file instanceof File)) return new Uint8Array();
  // Trop lourd : refusé sans lire le fichier en mémoire.
  if (file.size > MAX_LOGO_BYTES) throw new ValidationError("Logo trop lourd.", { fieldErrors: { logo: ["1 Mo maximum"] } });
  return new Uint8Array(await file.arrayBuffer());
}

/** Les partenaires s'affichent sur l'accueil public : il est rafraîchi. */
const refreshHome = () => revalidatePath("/");

export async function createPartnerAction(_state: ActionState, formData: FormData): Promise<ActionState> {
  return adminAction("/admin/contenu", async (actor) => {
    await createPartner(db, getStorage(), actor, partnerInput(formData), await logoBytes(formData));
    refreshHome();
    return "Partenaire ajouté.";
  });
}

export async function updatePartnerAction(id: string, _state: ActionState, formData: FormData): Promise<ActionState> {
  return adminAction("/admin/contenu", async (actor) => {
    const logo = await logoBytes(formData);
    await updatePartner(db, getStorage(), actor, id, partnerInput(formData), logo.byteLength > 0 ? logo : null);
    refreshHome();
    return "Partenaire enregistré.";
  });
}

export async function deletePartnerAction(id: string): Promise<ActionState> {
  return adminAction("/admin/contenu", async (actor) => {
    await deletePartner(db, actor, id);
    refreshHome();
    return "Partenaire supprimé.";
  });
}
