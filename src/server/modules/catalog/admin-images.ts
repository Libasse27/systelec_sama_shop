import "server-only";
import { randomUUID } from "node:crypto";
import { z } from "zod";
import type { PrismaClient } from "@/generated/prisma/client";
import { recordAudit } from "@/server/audit/audit";
import { assertPermission, type Actor } from "@/server/authz/service";
import { AppError, ValidationError } from "@/server/errors";
import { logger } from "@/server/logger";
import { parseInput } from "@/server/validation";
import { detectImageType, MAX_IMAGE_BYTES } from "@/server/storage/image-type";
import { keyFromMediaUrl, mediaUrl, type FileStorage } from "@/server/storage/storage";

export const MAX_IMAGES_PER_PRODUCT = 12;

const altSchema = z.string().trim().min(3, "Décrivez l'image (3 caractères minimum)").max(200);

const parseAlt = (alt: unknown): string => parseInput(z.object({ alt: altSchema }), { alt }, "Image").alt;

/**
 * Téléverse une image : format vérifié sur le contenu réel (JPEG, PNG, WebP), taille plafonnée,
 * nom de fichier aléatoire. Le fichier est retiré si l'enregistrement en base échoue.
 */
export async function addProductImage(
  client: PrismaClient,
  storage: FileStorage,
  actor: Actor,
  productId: string,
  input: { bytes: Uint8Array; alt: unknown },
): Promise<{ id: string }> {
  await assertPermission(client, actor, "products.update");
  const alt = parseAlt(input.alt);
  if (input.bytes.byteLength === 0) throw new ValidationError("Choisissez une image.", { fieldErrors: { image: ["Fichier vide"] } });
  if (input.bytes.byteLength > MAX_IMAGE_BYTES) {
    throw new ValidationError("Image trop lourde.", { fieldErrors: { image: ["5 Mo maximum"] } });
  }
  const extension = detectImageType(input.bytes);
  if (!extension) {
    throw new ValidationError("Format d'image refusé.", { fieldErrors: { image: ["Formats acceptés : JPEG, PNG, WebP"] } });
  }
  const product = await client.product.findUnique({ where: { id: productId }, select: { id: true } });
  if (!product) throw new AppError("NOT_FOUND", "Produit introuvable.");

  const key = `produits/${productId.toLowerCase()}/${randomUUID()}.${extension}`;
  await storage.put(key, input.bytes);
  try {
    return await client.$transaction(async (tx) => {
      // Verrou sur le produit : deux téléversements simultanés ne dépassent pas la limite.
      await tx.$queryRaw`SELECT id FROM products WHERE id = ${productId} FOR UPDATE`;
      const count = await tx.productImage.count({ where: { productId } });
      if (count >= MAX_IMAGES_PER_PRODUCT) {
        throw new AppError("CONFLICT", `${MAX_IMAGES_PER_PRODUCT} images au maximum par produit.`);
      }
      const last = await tx.productImage.findFirst({ where: { productId }, orderBy: { position: "desc" }, select: { position: true } });
      const image = await tx.productImage.create({
        data: { productId, url: mediaUrl(key), alt, position: (last?.position ?? -1) + 1 },
        select: { id: true },
      });
      await recordAudit(tx, { actorId: actor.id, action: "product.image.add", entityType: "Product", entityId: productId, after: { key, alt } });
      return image;
    });
  } catch (error) {
    await removeQuietly(storage, key);
    throw error;
  }
}

export async function updateProductImageAlt(client: PrismaClient, actor: Actor, imageId: string, altInput: unknown): Promise<void> {
  await assertPermission(client, actor, "products.update");
  const alt = parseAlt(altInput);
  await client.$transaction(async (tx) => {
    const image = await tx.productImage.findUnique({ where: { id: imageId }, select: { productId: true, alt: true } });
    if (!image) throw new AppError("NOT_FOUND", "Image introuvable.");
    await tx.productImage.update({ where: { id: imageId }, data: { alt } });
    await recordAudit(tx, {
      actorId: actor.id,
      action: "product.image.update",
      entityType: "Product",
      entityId: image.productId,
      before: { alt: image.alt },
      after: { alt },
    });
  });
}

/** Échange la position de l'image avec sa voisine ; la première image est l'image principale. */
export async function moveProductImage(client: PrismaClient, actor: Actor, imageId: string, direction: "up" | "down"): Promise<void> {
  if (direction !== "up" && direction !== "down") throw new ValidationError("Sens de déplacement inconnu.");
  await assertPermission(client, actor, "products.update");
  await client.$transaction(async (tx) => {
    const image = await tx.productImage.findUnique({ where: { id: imageId }, select: { productId: true } });
    if (!image) throw new AppError("NOT_FOUND", "Image introuvable.");
    await tx.$queryRaw`SELECT id FROM products WHERE id = ${image.productId} FOR UPDATE`;
    const ordered = await tx.productImage.findMany({
      where: { productId: image.productId },
      orderBy: [{ position: "asc" }, { id: "asc" }],
      select: { id: true },
    });
    const from = ordered.findIndex((row) => row.id === imageId);
    if (from === -1) throw new AppError("NOT_FOUND", "Image introuvable.");
    const to = direction === "up" ? from - 1 : from + 1;
    if (to < 0 || to >= ordered.length) return;
    const reordered = ordered.map((row) => row.id);
    [reordered[from], reordered[to]] = [reordered[to]!, reordered[from]!];
    // Positions renumérotées 0..n-1 : corrige au passage d'éventuels doublons.
    for (const [position, id] of reordered.entries()) {
      await tx.productImage.update({ where: { id }, data: { position } });
    }
    await recordAudit(tx, { actorId: actor.id, action: "product.image.move", entityType: "Product", entityId: image.productId });
  });
}

/** Supprime l'image en base puis son fichier (un fichier orphelin est sans danger, l'inverse non). */
export async function deleteProductImage(client: PrismaClient, storage: FileStorage, actor: Actor, imageId: string): Promise<void> {
  await assertPermission(client, actor, "products.update");
  const image = await client.$transaction(async (tx) => {
    const found = await tx.productImage.findUnique({ where: { id: imageId }, select: { productId: true, url: true, alt: true } });
    if (!found) throw new AppError("NOT_FOUND", "Image introuvable.");
    await tx.productImage.delete({ where: { id: imageId } });
    await recordAudit(tx, { actorId: actor.id, action: "product.image.delete", entityType: "Product", entityId: found.productId, before: found });
    return found;
  });
  const key = keyFromMediaUrl(image.url);
  if (key) await removeQuietly(storage, key);
}

async function removeQuietly(storage: FileStorage, key: string): Promise<void> {
  try {
    await storage.remove(key);
  } catch (error) {
    logger.error("Fichier d'image non supprimé", { key, error: error instanceof Error ? error.message : "inconnue" });
  }
}
