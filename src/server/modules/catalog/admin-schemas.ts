import { z } from "zod";
import { optionalText } from "@/lib/schema-text";
import { isValidSlug, slugify } from "@/lib/slug";

const MAX_PRICE = 100_000_000;

/** Slug saisi, ou dérivé du nom s'il est vide ; toujours au format URL. */
const slugField = z
  .string()
  .trim()
  .optional()
  .nullable()
  .refine((value) => !value || isValidSlug(value), "Identifiant d'URL invalide (minuscules, chiffres et tirets)");

const withSlug = <T extends { name: string; slug?: string | null }>(data: T) => ({
  ...data,
  slug: data.slug || slugify(data.name),
});

const price = z.number().int("Montant entier en FCFA").min(0).max(MAX_PRICE);

export const categoryInputSchema = z
  .object({
    name: z.string().trim().min(2).max(120),
    slug: slugField,
    // Le formulaire envoie "" pour « aucune catégorie parente ».
    parentId: z.preprocess((value) => value || null, z.string().min(1).max(64).nullable()),
    description: optionalText(1000),
    position: z.number().int().min(0).max(10_000).default(0),
    isActive: z.boolean().default(true),
    seoTitle: optionalText(120),
    seoDescription: optionalText(300),
  })
  .transform(withSlug);

export type CategoryInput = z.input<typeof categoryInputSchema>;

const specSchema = z.object({ label: z.string().trim().min(1).max(80), value: z.string().trim().min(1).max(300) });

export const productInputSchema = z
  .object({
    categoryId: z.string().min(1).max(64),
    brandName: optionalText(80),
    name: z.string().trim().min(2).max(200),
    slug: slugField,
    model: optionalText(120),
    shortDescription: z.string().trim().min(10).max(300),
    description: z.string().trim().min(10).max(20_000),
    condition: z.enum(["NEW", "REFURBISHED", "USED"]).default("NEW"),
    warrantyMonths: z.number().int().min(0).max(120).optional().nullable().transform((v) => v ?? null),
    warrantyText: optionalText(300),
    specs: z.array(specSchema).max(60).default([]),
    weightGrams: z.number().int().min(0).max(10_000_000).optional().nullable().transform((v) => v ?? null),
    dimensions: optionalText(120),
    isFeatured: z.boolean().default(false),
    seoTitle: optionalText(120),
    seoDescription: optionalText(300),
  })
  .transform(withSlug);

export type ProductInput = z.input<typeof productInputSchema>;

const variantBase = z.object({
  sku: z
    .string()
    .trim()
    .toUpperCase()
    .regex(/^[A-Z0-9][A-Z0-9._-]{1,63}$/, "Référence (SKU) invalide : lettres, chiffres, point, tiret"),
  barcode: optionalText(64),
  name: z.string().trim().min(1).max(120),
  attributes: z.record(z.string().trim().min(1).max(60), z.string().trim().min(1).max(120)).default({}),
  price,
  compareAtPrice: price.optional().nullable().transform((v) => v ?? null),
  costPrice: price.optional().nullable().transform((v) => v ?? null),
  isActive: z.boolean().default(true),
});

const compareAtAbovePrice = (variant: { price: number; compareAtPrice: number | null }) =>
  variant.compareAtPrice === null || variant.compareAtPrice > variant.price;
const compareAtMessage = { message: "Le prix barré doit être supérieur au prix de vente", path: ["compareAtPrice"] };

export const variantInputSchema = variantBase.refine(compareAtAbovePrice, compareAtMessage);
export type VariantInput = z.input<typeof variantInputSchema>;

/** Création d'un produit : fiche + variante par défaut. */
export const newProductSchema = z.object({
  product: productInputSchema,
  variant: variantInputSchema,
});
export type NewProductInput = z.input<typeof newProductSchema>;
