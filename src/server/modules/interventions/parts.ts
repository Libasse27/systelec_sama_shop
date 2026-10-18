import "server-only";
import type { PrismaClient } from "@/generated/prisma/client";
import { recordAudit } from "@/server/audit/audit";
import type { Actor } from "@/server/authz/service";
import { AppError } from "@/server/errors";
import { applyStockMovement } from "@/server/modules/inventory/service";
import { parseInput } from "@/server/validation";
import { authorizeWork, lockForWork } from "./access";
import { partSchema } from "./schemas";

/**
 * Pièce utilisée pendant l'intervention. Avec une référence du catalogue, le stock sort
 * (mouvement OUT motivé, refusé si le disponible hors réservations est insuffisant) et le
 * prix d'achat est retenu comme coût interne.
 */
export async function addPart(client: PrismaClient, actor: Actor, interventionId: string, input: unknown): Promise<void> {
  await authorizeWork(client, actor, interventionId);
  const part = parseInput(partSchema, input, "Pièce");
  await client.$transaction(async (tx) => {
    // Verrou de l'intervention d'abord, puis celui du stock (même ordre partout).
    const intervention = await lockForWork(tx, actor, interventionId, ["IN_PROGRESS"]);
    const variant = part.sku
      ? await tx.productVariant.findUnique({ where: { sku: part.sku }, select: { id: true, name: true, costPrice: true, product: { select: { name: true } } } })
      : null;
    if (part.sku && !variant) throw new AppError("NOT_FOUND", `Référence ${part.sku} introuvable.`, { fieldErrors: { sku: ["Référence inconnue"] } });
    if (variant) {
      await applyStockMovement(tx, actor.id, {
        type: "OUT",
        variantId: variant.id,
        quantity: part.quantity,
        reason: `Pièce intervention ${intervention.number}`,
      }).catch((error: unknown) => {
        // Le technicien n'a pas à connaître les niveaux de stock (disponible, réservé).
        if (error instanceof AppError && error.code === "CONFLICT") throw new AppError("CONFLICT", "Stock insuffisant pour cette référence : voyez avec le magasin.");
        throw error;
      });
    }
    const label = part.label ?? `${variant!.product.name} — ${variant!.name}`;
    const created = await tx.interventionPart.create({
      data: { interventionId, variantId: variant?.id ?? null, label, quantity: part.quantity, unitCost: variant?.costPrice ?? null, createdById: actor.id },
      select: { id: true },
    });
    await recordAudit(tx, {
      actorId: actor.id,
      action: "intervention.part_add",
      entityType: "Intervention",
      entityId: interventionId,
      after: { partId: created.id, sku: part.sku, label, quantity: part.quantity },
    });
  });
}

/** Retire une pièce saisie par erreur, pendant l'intervention ; une pièce du catalogue revient en stock. */
export async function removePart(client: PrismaClient, actor: Actor, partId: string): Promise<void> {
  const found = await client.interventionPart.findUnique({ where: { id: partId }, select: { interventionId: true } });
  if (!found) throw new AppError("NOT_FOUND", "Pièce introuvable.");
  await authorizeWork(client, actor, found.interventionId);
  await client.$transaction(async (tx) => {
    const intervention = await lockForWork(tx, actor, found.interventionId, ["IN_PROGRESS"]);
    const part = await tx.interventionPart.findUnique({ where: { id: partId }, select: { variantId: true, quantity: true, label: true } });
    if (!part) throw new AppError("NOT_FOUND", "Pièce introuvable.");
    if (part.variantId) {
      await applyStockMovement(tx, actor.id, {
        type: "IN",
        variantId: part.variantId,
        quantity: part.quantity,
        reason: `Retour pièce non utilisée, intervention ${intervention.number}`,
      });
    }
    await tx.interventionPart.delete({ where: { id: partId } });
    await recordAudit(tx, { actorId: actor.id, action: "intervention.part_remove", entityType: "Intervention", entityId: intervention.id, before: part });
  });
}
