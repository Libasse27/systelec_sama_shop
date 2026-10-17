"use server";

import { revalidatePath } from "next/cache";
import { db } from "@/server/db/client";
import { removeLogo, saveSettings, uploadLogo } from "@/server/modules/settings/admin";
import { OFFLINE_PAYMENT_METHODS, settingsDefaults } from "@/server/modules/settings/schemas";
import { getStorage } from "@/server/storage/storage";
import type { ActionState } from "@/lib/form-state";
import { checkbox, int, text } from "@/lib/form-data";
import { adminAction } from "../_lib/action";

const PATH = "/admin/parametres";

/** Champ facultatif : vide → null (la valeur est effacée). */
const nullable = (formData: FormData, name: string): string | null => text(formData, name)?.trim() || null;

/** Les paramètres de l'entreprise s'affichent sur tout le site : toutes les pages sont rafraîchies. */
const refreshSite = () => revalidatePath("/", "layout");

export async function saveCompanyAction(_state: ActionState, formData: FormData): Promise<ActionState> {
  return adminAction(PATH, async (actor) => {
    await saveSettings(db, actor, "company", {
      companyName: text(formData, "companyName"),
      shopName: text(formData, "shopName"),
      logoUrl: nullable(formData, "logoUrl"),
      phone: nullable(formData, "phone"),
      whatsapp: nullable(formData, "whatsapp"),
      email: nullable(formData, "email"),
      address: nullable(formData, "address"),
      openingHours: nullable(formData, "openingHours"),
      ninea: nullable(formData, "ninea"),
      rccm: nullable(formData, "rccm"),
      socialLinks: {
        facebook: nullable(formData, "socialLinks.facebook"),
        instagram: nullable(formData, "socialLinks.instagram"),
        linkedin: nullable(formData, "socialLinks.linkedin"),
        tiktok: nullable(formData, "socialLinks.tiktok"),
      },
    });
    refreshSite();
    return "Identité et mentions légales enregistrées.";
  });
}

export async function saveCommerceAction(_state: ActionState, formData: FormData): Promise<ActionState> {
  return adminAction(PATH, async (actor) => {
    await saveSettings(db, actor, "commerce", {
      currency: settingsDefaults.commerce.currency,
      timezone: settingsDefaults.commerce.timezone,
      guestCheckoutEnabled: checkbox(formData, "guestCheckoutEnabled"),
      partialPaymentEnabled: checkbox(formData, "partialPaymentEnabled"),
      stockReservationHours: int(formData, "stockReservationHours"),
    });
    return "Règles de commande enregistrées.";
  });
}

export async function savePaymentsAction(_state: ActionState, formData: FormData): Promise<ActionState> {
  return adminAction(PATH, async (actor) => {
    await saveSettings(db, actor, "payments", { enabledMethods: OFFLINE_PAYMENT_METHODS.filter((method) => checkbox(formData, method)) });
    return "Moyens de règlement enregistrés.";
  });
}

export async function saveTaxAction(_state: ActionState, formData: FormData): Promise<ActionState> {
  return adminAction(PATH, async (actor) => {
    await saveSettings(db, actor, "tax", { vatDetailEnabled: checkbox(formData, "vatDetailEnabled"), vatRate: int(formData, "vatRate") });
    return "TVA enregistrée.";
  });
}

export async function saveFeaturesAction(_state: ActionState, formData: FormData): Promise<ActionState> {
  return adminAction(PATH, async (actor) => {
    await saveSettings(db, actor, "features", { reviewsEnabled: checkbox(formData, "reviewsEnabled") });
    return "Fonctions enregistrées.";
  });
}

export async function uploadLogoAction(_state: ActionState, formData: FormData): Promise<ActionState> {
  return adminAction(PATH, async (actor) => {
    const file = formData.get("logo");
    const bytes = file instanceof File ? new Uint8Array(await file.arrayBuffer()) : new Uint8Array();
    await uploadLogo(db, getStorage(), actor, bytes);
    refreshSite();
    return "Logo enregistré.";
  });
}

export async function removeLogoAction(): Promise<ActionState> {
  return adminAction(PATH, async (actor) => {
    await removeLogo(db, actor);
    refreshSite();
    return "Logo retiré : le logo typographique provisoire est affiché.";
  });
}
