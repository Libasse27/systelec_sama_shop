import { z } from "zod";
import { optionalText } from "@/lib/schema-text";
import { contactSchema } from "@/server/modules/orders/schemas";

const text = (min: number, max: number) => z.string().trim().min(min).max(max);
export const MAX_QUOTE_LINES = 50;
/** Plafonds de saisie : une faute de frappe (zéros en trop) est refusée. */
export const MAX_LINE_QUANTITY = 10_000;
export const MAX_UNIT_PRICE = 50_000_000;

export const quoteRequestSchema = z.object({
  idempotencyKey: z.uuid(),
  contact: contactSchema,
  serviceSlug: optionalText(200),
  address: text(5, 300),
  description: text(10, 2000),
  urgency: z.enum(["NORMAL", "URGENT"]).default("NORMAL"),
  availability: optionalText(300),
});

export const quoteItemSchema = z.object({
  kind: z.enum(["MATERIAL", "LABOR", "TRAVEL", "OTHER"]),
  label: text(2, 200),
  quantity: z.number({ error: "Quantité requise" }).int("Quantité entière").min(1).max(MAX_LINE_QUANTITY),
  unitPrice: z.number({ error: "Prix unitaire requis" }).int("Prix en francs CFA entiers").min(0).max(MAX_UNIT_PRICE),
});

export const quoteDraftSchema = z.object({
  /** Fin de validité : date AAAA-MM-JJ (journée de Dakar). */
  validUntil: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Date de validité invalide"),
  notes: optionalText(2000),
  items: z.array(quoteItemSchema).max(MAX_QUOTE_LINES, `${MAX_QUOTE_LINES} lignes au plus`),
});

export const quoteDecisionSchema = z.object({
  accept: z.boolean(),
  note: optionalText(500),
});

export const requestStatusSchema = z
  .object({
    status: z.enum(["IN_REVIEW", "CANCELLED"]),
    note: optionalText(500),
  })
  .refine((change) => change.status !== "CANCELLED" || change.note !== null, {
    message: "Indiquez le motif (visible par le client)",
    path: ["note"],
  });

export type QuoteItemInput = z.infer<typeof quoteItemSchema>;
