import { z } from "zod";
import { optionalText } from "@/lib/schema-text";

/** Plafond de sécurité d'un encaissement (100 millions FCFA) : une faute de frappe est refusée. */
export const MAX_PAYMENT_AMOUNT = 100_000_000;

export const recordPaymentSchema = z.object({
  amount: z.number({ error: "Montant à encaisser requis" }).int("Montant en francs CFA entiers").min(1, "Montant à encaisser requis").max(MAX_PAYMENT_AMOUNT),
  note: optionalText(300),
  idempotencyKey: z.uuid(),
});

export const voidPaymentSchema = z.object({
  reason: z.string().trim().min(3, "Indiquez le motif de l'annulation").max(300),
});
