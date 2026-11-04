import { z } from "zod";
import { isMobilePaymentMethod, normalizeTransactionReference, PAYMENT_METHODS, TRANSACTION_REFERENCE_PATTERN, transactionReferenceKey } from "@/lib/payment-methods";
import { optionalText } from "@/lib/schema-text";

/** Plafond de sécurité d'un encaissement (100 millions FCFA) : une faute de frappe est refusée. */
export const MAX_PAYMENT_AMOUNT = 100_000_000;

/** Moyen de paiement (espèces par défaut) et référence de la transaction mobile, normalisée. */
export const paymentMethodFields = {
  method: z.enum(PAYMENT_METHODS, { error: "Moyen de paiement invalide" }).default("CASH"),
  transactionReference: z
    .string({ error: "Référence de transaction invalide" })
    .nullish()
    .transform(normalizeTransactionReference)
    .refine((value) => value === null || TRANSACTION_REFERENCE_PATTERN.test(value), "La référence compte 4 à 64 caractères : lettres, chiffres, point, tiret ou tiret bas.")
    .refine((value) => value === null || transactionReferenceKey(value) !== "", "La référence doit contenir au moins une lettre ou un chiffre."),
};

/** Règle commune : référence obligatoire pour un moyen mobile, refusée (jamais ignorée) pour des espèces. */
export function requireReferenceForMobile(value: { method: (typeof PAYMENT_METHODS)[number]; transactionReference: string | null }, context: z.RefinementCtx): void {
  const mobile = isMobilePaymentMethod(value.method);
  if (mobile && value.transactionReference === null) {
    context.addIssue({ code: "custom", path: ["transactionReference"], message: "Indiquez la référence de la transaction" });
  } else if (!mobile && value.transactionReference !== null) {
    context.addIssue({ code: "custom", path: ["transactionReference"], message: "Une référence ne s'applique qu'à un paiement mobile : retirez-la pour des espèces." });
  }
}

export const recordPaymentSchema = z.object({
  amount: z.number({ error: "Montant à encaisser requis" }).int("Montant en francs CFA entiers").min(1, "Montant à encaisser requis").max(MAX_PAYMENT_AMOUNT),
  ...paymentMethodFields,
  note: optionalText(300),
  idempotencyKey: z.uuid(),
}).superRefine(requireReferenceForMobile);

export const voidPaymentSchema = z.object({
  reason: z.string().trim().min(3, "Indiquez le motif de l'annulation").max(300),
});
