import { z } from "zod";
import { optionalText } from "@/lib/schema-text";

const text = (min: number, max: number) => z.string().trim().min(min).max(max);
/** Téléphone : chiffres, espaces et « + » initial ; 8 à 15 chiffres (numéros sénégalais et internationaux). */
export const phoneSchema = z
  .string()
  .trim()
  .regex(/^\+?[\d ]+$/, "Numéro de téléphone invalide")
  .refine((value) => {
    const digits = value.replace(/\D/g, "").length;
    return digits >= 8 && digits <= 15;
  }, "Numéro de téléphone invalide")
  .transform((value) => value.replace(/\s+/g, " "));

export const contactSchema = z.object({
  name: text(2, 120),
  phone: phoneSchema,
  email: z
    .string()
    .trim()
    .toLowerCase()
    .max(254)
    .optional()
    .nullable()
    .transform((value) => value || null)
    .pipe(z.email("Adresse e-mail invalide").nullable()),
});

export const addressSchema = z.object({
  line1: text(3, 200),
  district: text(2, 120),
  city: text(2, 120),
  landmark: optionalText(200),
});

export const checkoutSchema = z.object({
  idempotencyKey: z.uuid(),
  contact: contactSchema,
  fulfillment: z.discriminatedUnion("method", [
    z.object({ method: z.literal("DELIVERY"), deliveryZoneId: z.string().min(1).max(64), address: addressSchema }),
    z.object({ method: z.literal("PICKUP"), pickupPointId: z.string().min(1).max(64) }),
  ]),
  notes: optionalText(500),
  /** Sous-total affiché au client : s'il ne correspond plus aux prix actuels, il doit revalider. */
  expectedSubtotal: z.number().int().min(0).optional(),
});

export type CheckoutInput = z.input<typeof checkoutSchema>;
export type Contact = z.infer<typeof contactSchema>;
export type ShippingAddress = z.infer<typeof addressSchema>;
