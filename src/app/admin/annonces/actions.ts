"use server";

import { revalidatePath } from "next/cache";
import { db } from "@/server/db/client";
import { addAnnouncement, deleteAnnouncement, saveRotation, updateAnnouncement } from "@/server/modules/announcements/admin";
import { parseLocalDateTime } from "@/server/modules/announcements/form";
import { ValidationError } from "@/server/errors";
import type { ActionState } from "@/lib/form-state";
import { checkbox, int, text } from "@/lib/form-data";
import { adminAction } from "../_lib/action";

const PATH = "/admin/annonces";

/** Le bandeau figure dans la mise en page de tout le site : toutes les pages sont rafraîchies. */
const refreshSite = () => revalidatePath("/", "layout");

/** Champ facultatif : vide → null (la valeur est effacée). */
const nullable = (formData: FormData, name: string): string | null => text(formData, name)?.trim() || null;

/** Date facultative : vide → null ; toute saisie qui n'est pas au format « datetime-local » est refusée sur son champ. */
function optionalInstant(formData: FormData, name: string): string | null {
  const raw = nullable(formData, name);
  if (raw === null) return null;
  const instant = parseLocalDateTime(raw);
  if (instant === null) throw new ValidationError("Annonce invalide", { fieldErrors: { [name]: ["Date et heure au format AAAA-MM-JJ HH:mm"] } });
  return instant;
}

/** Champs saisis d'une annonce (l'identifiant est attribué ou fixé par le serveur). */
function announcementFields(formData: FormData) {
  return {
    text: text(formData, "text"),
    href: nullable(formData, "href"),
    kind: text(formData, "kind"),
    isActive: checkbox(formData, "isActive"),
    startsAt: optionalInstant(formData, "startsAt"),
    endsAt: optionalInstant(formData, "endsAt"),
  };
}

export async function addAnnouncementAction(_state: ActionState, formData: FormData): Promise<ActionState> {
  return adminAction(PATH, async (actor) => {
    await addAnnouncement(db, actor, announcementFields(formData));
    refreshSite();
    return "Annonce ajoutée.";
  });
}

export async function updateAnnouncementAction(id: string, _state: ActionState, formData: FormData): Promise<ActionState> {
  return adminAction(PATH, async (actor) => {
    await updateAnnouncement(db, actor, id, announcementFields(formData));
    refreshSite();
    return "Annonce enregistrée.";
  });
}

export async function deleteAnnouncementAction(id: string): Promise<ActionState> {
  return adminAction(PATH, async (actor) => {
    await deleteAnnouncement(db, actor, id);
    refreshSite();
    return "Annonce supprimée.";
  });
}

export async function saveRotationAction(_state: ActionState, formData: FormData): Promise<ActionState> {
  return adminAction(PATH, async (actor) => {
    await saveRotation(db, actor, int(formData, "rotationSeconds"));
    refreshSite();
    return "Durée d'affichage enregistrée.";
  });
}
