import { z } from "zod";
import { optionalText } from "@/lib/schema-text";
import { MAX_PAYMENT_AMOUNT } from "@/server/modules/payments/schemas";

export const createReturnSchema = z.object({
  idempotencyKey: z.uuid(),
  reason: z.string().trim().min(3, "Indiquez le motif du retour").max(500),
  items: z
    .array(z.object({ orderItemId: z.string().min(1).max(64), quantity: z.number().int("Quantité entière").min(0).max(10_000) }))
    .max(100)
    // Les lignes laissées à 0 ne sont pas retournées.
    .transform((items) => items.filter((item) => item.quantity > 0))
    .refine((items) => items.length > 0, "Indiquez au moins un article retourné")
    .refine((items) => new Set(items.map((item) => item.orderItemId)).size === items.length, "Article en double"),
});

export const RETURN_EXCEPTION_GROUNDS = ["WARRANTY", "HIDDEN_DEFECT", "LEGAL_OBLIGATION", "OTHER"] as const;
export const RETURN_VERIFICATION_KINDS = ["INSPECTION", "PHOTOS", "INVOICE", "INFORMATION"] as const;

export const decideReturnSchema = z.discriminatedUnion("decision", [
  z.object({
    decision: z.literal("ACCEPT"),
    restock: z.boolean(),
    refundAmount: z.number({ error: "Montant à rembourser requis" }).int("Montant en francs CFA entiers").min(0).max(MAX_PAYMENT_AMOUNT),
    note: z.string().trim().min(3, "Motivez la décision (état des articles, remise en stock ou non)").max(500),
    // Retour déclaré hors délai : exception motivée (garantie, vice caché, obligation légale…), exigée par le service.
    exceptionGround: z.preprocess(
      (value) => (value === "" ? null : value),
      z.enum(RETURN_EXCEPTION_GROUNDS, { error: "Fondement de l'exception invalide" }).optional().nullable(),
    ),
    exceptionNote: optionalText(500),
  }),
  z.object({
    decision: z.literal("REJECT"),
    note: z.string().trim().min(3, "Indiquez le motif du refus").max(500),
  }),
]);

export const refundReturnSchema = z.object({
  idempotencyKey: z.uuid(),
  note: optionalText(300),
});

/** Demande de vérification avant la décision : nature et précisions (photos attendues, points à inspecter…). */
export const requestVerificationSchema = z.object({
  kind: z.enum(RETURN_VERIFICATION_KINDS, { error: "Choisissez la nature de la vérification" }),
  request: z.string().trim().min(3, "Précisez la demande").max(500),
});

/** Réponse ou résultat de la vérification demandée. */
export const answerVerificationSchema = z.object({
  response: z.string().trim().min(3, "Indiquez la réponse ou le résultat de la vérification").max(1_000),
});
