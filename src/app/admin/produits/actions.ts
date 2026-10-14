"use server";

import { redirect } from "next/navigation";
import type { ProductStatus } from "@/generated/prisma/client";
import { db } from "@/server/db/client";
import { addProductImage, deleteProductImage, moveProductImage, updateProductImageAlt } from "@/server/modules/catalog/admin-images";
import {
  addVariant,
  createProduct,
  setDefaultVariant,
  setProductStatus,
  updateProduct,
  updateVariant,
} from "@/server/modules/catalog/admin-products";
import { getStorage } from "@/server/storage/storage";
import { adminAction } from "../_lib/action";
import { checkbox, int, labelValueLines, optionalInt, text } from "../_lib/form-data";
import type { ActionState } from "../_lib/form-state";

const productPath = (id: string) => `/admin/produits/${id}`;

function productFields(formData: FormData) {
  return {
    categoryId: text(formData, "categoryId"),
    brandName: text(formData, "brandName"),
    name: text(formData, "name"),
    slug: text(formData, "slug"),
    model: text(formData, "model"),
    shortDescription: text(formData, "shortDescription"),
    description: text(formData, "description"),
    condition: text(formData, "condition"),
    warrantyMonths: optionalInt(formData, "warrantyMonths"),
    warrantyText: text(formData, "warrantyText"),
    specs: labelValueLines(text(formData, "specs")),
    weightGrams: optionalInt(formData, "weightGrams"),
    dimensions: text(formData, "dimensions"),
    isFeatured: checkbox(formData, "isFeatured"),
    seoTitle: text(formData, "seoTitle"),
    seoDescription: text(formData, "seoDescription"),
  };
}

/** Champs d'une version ; `prefix` distingue la version du formulaire de création (« variant. »). */
function variantFields(formData: FormData, prefix = "") {
  const attributes = labelValueLines(text(formData, `${prefix}attributes`));
  return {
    sku: text(formData, `${prefix}sku`),
    barcode: text(formData, `${prefix}barcode`),
    name: text(formData, `${prefix}name`),
    attributes: Object.fromEntries(attributes.map((item) => [item.label, item.value])),
    price: int(formData, `${prefix}price`),
    compareAtPrice: optionalInt(formData, `${prefix}compareAtPrice`),
    costPrice: optionalInt(formData, `${prefix}costPrice`),
    isActive: prefix ? true : checkbox(formData, `${prefix}isActive`),
  };
}

export async function createProductAction(_state: ActionState, formData: FormData): Promise<ActionState> {
  let createdId: string | undefined;
  const state = await adminAction("/admin/produits/nouveau", async (actor) => {
    createdId = (await createProduct(db, actor, { product: productFields(formData), variant: variantFields(formData, "variant.") })).id;
  });
  if (!createdId) {
    // Les erreurs du produit portent le chemin « product.x » : on les rattache aux champs « x ».
    const fieldErrors = state.fieldErrors && Object.fromEntries(Object.entries(state.fieldErrors).map(([key, value]) => [key.replace(/^product\./, ""), value]));
    return { ...state, fieldErrors };
  }
  redirect(productPath(createdId));
}

export async function updateProductAction(id: string, _state: ActionState, formData: FormData): Promise<ActionState> {
  return adminAction(productPath(id), async (actor) => {
    await updateProduct(db, actor, id, productFields(formData));
    return "Fiche produit enregistrée.";
  });
}

const STATUS_MESSAGES: Record<ProductStatus, string> = {
  PUBLISHED: "Produit publié : il est visible sur la boutique.",
  DRAFT: "Produit repassé en brouillon : il n'est plus visible sur la boutique.",
  ARCHIVED: "Produit archivé.",
};

/** Statut demandé par le bouton cliqué (validé par le service). */
export async function setProductStatusAction(id: string, _state: ActionState, formData: FormData): Promise<ActionState> {
  const status = text(formData, "status") as ProductStatus;
  return adminAction(productPath(id), async (actor) => {
    await setProductStatus(db, actor, id, status);
    return STATUS_MESSAGES[status];
  });
}

export async function addVariantAction(productId: string, _state: ActionState, formData: FormData): Promise<ActionState> {
  return adminAction(productPath(productId), async (actor) => {
    await addVariant(db, actor, productId, variantFields(formData));
    return "Version ajoutée (stock à 0 : enregistrez une entrée de stock).";
  });
}

export async function updateVariantAction(productId: string, variantId: string, _state: ActionState, formData: FormData): Promise<ActionState> {
  return adminAction(productPath(productId), async (actor) => {
    await updateVariant(db, actor, variantId, variantFields(formData));
    return "Version enregistrée.";
  });
}

export async function setDefaultVariantAction(productId: string, variantId: string): Promise<ActionState> {
  return adminAction(productPath(productId), async (actor) => {
    await setDefaultVariant(db, actor, variantId);
    return "Version par défaut modifiée.";
  });
}

export async function addImageAction(productId: string, _state: ActionState, formData: FormData): Promise<ActionState> {
  return adminAction(productPath(productId), async (actor) => {
    const file = formData.get("image");
    const bytes = file instanceof File ? new Uint8Array(await file.arrayBuffer()) : new Uint8Array();
    await addProductImage(db, getStorage(), actor, productId, { bytes, alt: text(formData, "alt") });
    return "Image ajoutée.";
  });
}

export async function updateImageAltAction(productId: string, imageId: string, _state: ActionState, formData: FormData): Promise<ActionState> {
  return adminAction(productPath(productId), async (actor) => {
    await updateProductImageAlt(db, actor, imageId, text(formData, "alt"));
    return "Description enregistrée.";
  });
}

export async function moveImageAction(productId: string, imageId: string, direction: "up" | "down"): Promise<ActionState> {
  return adminAction(productPath(productId), async (actor) => {
    await moveProductImage(db, actor, imageId, direction);
    return "Ordre des images modifié.";
  });
}

export async function deleteImageAction(productId: string, imageId: string): Promise<ActionState> {
  return adminAction(productPath(productId), async (actor) => {
    await deleteProductImage(db, getStorage(), actor, imageId);
    return "Image supprimée.";
  });
}
