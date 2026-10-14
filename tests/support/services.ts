import { randomUUID } from "node:crypto";
import type { Actor } from "@/server/authz/service";
import { db } from "@/server/db/client";
import { decideQuote, createQuoteDraft, saveQuoteDraft, sendQuote } from "@/server/modules/quotes/quotes";
import { submitQuoteRequest } from "@/server/modules/quotes/requests";
import { saveTechnicianProfile } from "@/server/modules/technicians/service";
import { actorWith } from "./actors";

export const requestContact = { name: "Fatou Sow", phone: "78 222 33 44", email: "fatou@example.sn" };

/** Service publié de la catégorie « Vidéosurveillance ». */
export async function seedService(): Promise<{ id: string; slug: string }> {
  const category = await db.serviceCategory.create({ data: { name: "Vidéosurveillance", slug: "videosurveillance" } });
  return db.service.create({
    data: { categoryId: category.id, name: "Installation de caméras", slug: "installation-cameras", shortDescription: "Court", description: "Long" },
    select: { id: true, slug: true },
  });
}

export function requestInput(overrides: Record<string, unknown> = {}) {
  return {
    idempotencyKey: randomUUID(),
    contact: requestContact,
    serviceSlug: "installation-cameras",
    address: "Villa 12, Sacré-Cœur 3, Dakar",
    description: "Installer quatre caméras autour de la maison avec enregistreur.",
    urgency: "NORMAL",
    ...overrides,
  };
}

/** Date AAAA-MM-JJ dans `days` jours. */
export const dayIn = (days: number) => new Date(Date.now() + days * 24 * 3600 * 1000).toISOString().slice(0, 10);

export const quoteLines = [
  { kind: "MATERIAL", label: "Caméra IP extérieure", quantity: 4, unitPrice: 35_000 },
  { kind: "LABOR", label: "Pose et câblage", quantity: 1, unitPrice: 40_000 },
] as const;
export const QUOTE_TOTAL = 180_000;

/** Demande invitée → devis envoyé ; renvoie les identifiants utiles. */
export async function sentQuote(manager: Actor, userId: string | null = null) {
  const request = await submitQuoteRequest(db, { userId }, requestInput());
  const quote = await createQuoteDraft(db, manager, request.id);
  await saveQuoteDraft(db, manager, quote.id, { validUntil: dayIn(30), notes: "Garantie 12 mois.", items: quoteLines });
  await sendQuote(db, manager, quote.id);
  return { request, quote };
}

/** … puis accepté par le personnel (accord téléphonique) : renvoie l'intervention créée. */
export async function acceptedIntervention(manager: Actor, userId: string | null = null) {
  const { request, quote } = await sentQuote(manager, userId);
  await decideQuote(db, { kind: "staff", actor: manager }, quote.id, { accept: true, note: "Accord par téléphone" });
  const intervention = await db.intervention.findUniqueOrThrow({ where: { quoteId: quote.id }, select: { id: true, number: true } });
  return { request, quote, intervention };
}

/** Compte technicien avec profil actif. */
export async function technician(manager: Actor, zones = "Dakar"): Promise<{ actor: Actor; technicianId: string }> {
  const actor = await actorWith("TECHNICIAN");
  await saveTechnicianProfile(db, manager, actor.id, { skills: "Vidéosurveillance", zones, isActive: true });
  const { id } = await db.technician.findUniqueOrThrow({ where: { userId: actor.id }, select: { id: true } });
  return { actor, technicianId: id };
}
