import "server-only";
import type { Prisma } from "@/generated/prisma/client";
import type { Contact } from "@/server/modules/orders/schemas";

/**
 * Fiche client d'un document : celle du compte (coordonnées mises à jour), ou une fiche
 * invitée propre au document (jamais fusionnée sur le seul téléphone, qui n'est pas vérifié).
 */
export async function resolveCustomer(tx: Prisma.TransactionClient, userId: string | null, contact: Contact): Promise<string> {
  const data = { name: contact.name, phone: contact.phone, email: contact.email };
  if (!userId) return (await tx.customer.create({ data, select: { id: true } })).id;
  return (await tx.customer.upsert({ where: { userId }, create: { ...data, userId }, update: data, select: { id: true } })).id;
}
