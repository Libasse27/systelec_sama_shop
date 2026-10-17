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

export const decideReturnSchema = z.discriminatedUnion("decision", [
  z.object({
    decision: z.literal("ACCEPT"),
    restock: z.boolean(),
    refundAmount: z.number({ error: "Montant à rembourser requis" }).int("Montant en francs CFA entiers").min(0).max(MAX_PAYMENT_AMOUNT),
    note: z.string().trim().min(3, "Motivez la décision (état des articles, remise en stock ou non)").max(500),
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
