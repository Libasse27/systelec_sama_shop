import "server-only";
import { z } from "zod";
import { Prisma, type PrismaClient } from "@/generated/prisma/client";
import { recordAudit } from "@/server/audit/audit";
import { assertPermission, type Actor } from "@/server/authz/service";
import type { Db } from "@/server/db/client";
import { AppError } from "@/server/errors";
import { parseInput } from "@/server/validation";

const MAX_FEE = 10_000_000;
const optionalText = (max: number) =>
  z
    .string()
    .trim()
    .max(max)
    .optional()
    .nullable()
    .transform((value) => value || null);

export const deliveryZoneSchema = z.object({
  name: z.string().trim().min(2).max(120),
  description: optionalText(300),
  fee: z.number().int().min(0).max(MAX_FEE),
  freeAbove: z.number().int().min(0).max(1_000_000_000).nullable().optional().transform((value) => value ?? null),
  leadTimeText: optionalText(120),
  isActive: z.boolean().default(true),
  position: z.number().int().min(0).max(10_000).default(0),
});

export const pickupPointSchema = z.object({
  name: z.string().trim().min(2).max(120),
  address: z.string().trim().min(5).max(300),
  hours: optionalText(300),
  phone: optionalText(30),
  isActive: z.boolean().default(true),
});

function nameConflict(error: unknown): never {
  if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002") {
    throw new AppError("CONFLICT", "Ce nom est déjà utilisé.");
  }
  throw error;
}

/** Crée (id absent) ou modifie une zone de livraison. Les commandes passées gardent leurs frais figés. */
export async function saveDeliveryZone(client: PrismaClient, actor: Actor, id: string | null, input: unknown): Promise<void> {
  await assertPermission(client, actor, "deliveries.manage");
  const data = parseInput(deliveryZoneSchema, input, "Zone de livraison");
  await client.$transaction(async (tx) => {
    const before = id ? await tx.deliveryZone.findUnique({ where: { id } }) : null;
    if (id && !before) throw new AppError("NOT_FOUND", "Zone introuvable.");
    const saved = await (id ? tx.deliveryZone.update({ where: { id }, data }) : tx.deliveryZone.create({ data })).catch(nameConflict);
    await recordAudit(tx, { actorId: actor.id, action: id ? "delivery_zone.update" : "delivery_zone.create", entityType: "DeliveryZone", entityId: saved.id, before, after: data });
  });
}

export async function savePickupPoint(client: PrismaClient, actor: Actor, id: string | null, input: unknown): Promise<void> {
  await assertPermission(client, actor, "deliveries.manage");
  const data = parseInput(pickupPointSchema, input, "Point de retrait");
  await client.$transaction(async (tx) => {
    const before = id ? await tx.pickupPoint.findUnique({ where: { id } }) : null;
    if (id && !before) throw new AppError("NOT_FOUND", "Point de retrait introuvable.");
    const saved = await (id ? tx.pickupPoint.update({ where: { id }, data }) : tx.pickupPoint.create({ data })).catch(nameConflict);
    await recordAudit(tx, { actorId: actor.id, action: id ? "pickup_point.update" : "pickup_point.create", entityType: "PickupPoint", entityId: saved.id, before, after: data });
  });
}

/** Toutes les zones et tous les points (actifs ou non) pour l'administration. */
export async function listDeliverySettings(client: Db, actor: Actor) {
  await assertPermission(client, actor, "deliveries.manage");
  const [zones, pickupPoints] = await Promise.all([
    client.deliveryZone.findMany({ orderBy: [{ position: "asc" }, { name: "asc" }] }),
    client.pickupPoint.findMany({ orderBy: { name: "asc" } }),
  ]);
  return { zones, pickupPoints };
}
