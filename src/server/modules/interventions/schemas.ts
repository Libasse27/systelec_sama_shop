import { z } from "zod";
import { optionalText } from "@/lib/schema-text";

/** Durée d'un créneau : 15 minutes à 12 heures. */
export const MIN_SLOT_MINUTES = 15;
export const MAX_SLOT_MINUTES = 12 * 60;

export const scheduleSchema = z.object({
  technicianId: z.string().min(1, "Choisissez un technicien").max(64),
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Date invalide"),
  time: z.string().regex(/^\d{2}:\d{2}$/, "Heure invalide"),
  durationMinutes: z.number({ error: "Durée requise" }).int().min(MIN_SLOT_MINUTES).max(MAX_SLOT_MINUTES),
});

export const reportSchema = z.object({
  diagnosis: z.string().trim().min(3, "Diagnostic requis").max(4000),
  workDone: z.string().trim().min(3, "Travaux réalisés requis").max(4000),
  timeSpentMin: z.number({ error: "Temps passé requis" }).int().min(1).max(24 * 60 * 7),
  observations: optionalText(4000),
});

export const partSchema = z.object({
  /** Référence du catalogue (sortie de stock tracée), ou vide pour une pièce hors catalogue. */
  sku: optionalText(64).transform((value) => value?.toUpperCase() ?? null),
  label: optionalText(200),
  quantity: z.number({ error: "Quantité requise" }).int().min(1).max(1000),
}).refine((part) => part.sku !== null || part.label !== null, { message: "Indiquez une référence ou une désignation", path: ["label"] });

export const completeSchema = z.object({
  customerSignOff: z.string().trim().min(2, "Nom de la personne présente requis").max(120),
});

export const cancelSchema = z.object({
  reason: z.string().trim().min(3, "Indiquez le motif de l'annulation").max(500),
});

export const directInterventionSchema = z.object({
  amountDue: z.number({ error: "Montant requis" }).int().min(0).max(50_000_000),
  problem: z.string().trim().min(5).max(2000),
});
