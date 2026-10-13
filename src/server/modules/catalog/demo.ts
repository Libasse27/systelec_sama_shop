import "server-only";
import type { PrismaClient, ProductCondition, ProductStatus } from "@/generated/prisma/client";
import { slugify } from "@/lib/slug";

/**
 * Données de DÉMONSTRATION (D5) : marques fictives, produits préfixés « [DÉMO] ».
 * Jamais chargées en production (voir scripts/seed-demo.ts).
 */
export const DEMO_PREFIX = "[DÉMO]";

interface DemoVariant {
  sku: string;
  name: string;
  price: number;
  compareAtPrice?: number;
  costPrice: number;
  onHand: number;
  attributes?: Record<string, string>;
}

interface DemoProduct {
  name: string;
  category: string;
  brand: string;
  model: string;
  condition?: ProductCondition;
  status?: ProductStatus;
  isFeatured?: boolean;
  warrantyMonths?: number;
  specs: { label: string; value: string }[];
  variants: DemoVariant[];
}

const DEMO_PRODUCTS: DemoProduct[] = [
  {
    name: "Ordinateur portable 15 pouces Pro",
    category: "ordinateurs-portables",
    brand: "DémoTech",
    model: "DT-15P",
    isFeatured: true,
    warrantyMonths: 12,
    specs: [
      { label: "Processeur", value: "8 cœurs" },
      { label: "Écran", value: "15,6 pouces Full HD" },
    ],
    variants: [
      { sku: "DEMO-DT15P-8", name: "8 Go / SSD 256 Go", price: 385_000, costPrice: 300_000, onHand: 4, attributes: { Mémoire: "8 Go" } },
      { sku: "DEMO-DT15P-16", name: "16 Go / SSD 512 Go", price: 465_000, costPrice: 360_000, onHand: 2, attributes: { Mémoire: "16 Go" } },
    ],
  },
  {
    name: "Ordinateur portable 14 pouces reconditionné",
    category: "ordinateurs-portables",
    brand: "DémoTech",
    model: "DT-14R",
    condition: "REFURBISHED",
    warrantyMonths: 6,
    specs: [{ label: "Écran", value: "14 pouces HD" }],
    variants: [{ sku: "DEMO-DT14R", name: "Standard", price: 165_000, compareAtPrice: 195_000, costPrice: 120_000, onHand: 3 }],
  },
  {
    name: "Écran 24 pouces IPS",
    category: "ecrans",
    brand: "VisioDémo",
    model: "VD-24",
    specs: [{ label: "Taille", value: "24 pouces" }],
    variants: [{ sku: "DEMO-VD24", name: "Standard", price: 98_000, costPrice: 75_000, onHand: 0 }],
  },
  {
    name: "SSD interne 1 To",
    category: "ssd-et-disques-durs",
    brand: "DémoTech",
    model: "DT-SSD1",
    isFeatured: true,
    specs: [{ label: "Capacité", value: "1 To" }],
    variants: [{ sku: "DEMO-SSD1T", name: "1 To", price: 52_000, costPrice: 40_000, onHand: 15 }],
  },
  {
    name: "Routeur Wi-Fi 6 double bande",
    category: "routeurs",
    brand: "NetDémo",
    model: "ND-AX3",
    isFeatured: true,
    warrantyMonths: 24,
    specs: [{ label: "Norme", value: "Wi-Fi 6" }],
    variants: [{ sku: "DEMO-NDAX3", name: "Standard", price: 59_500, costPrice: 45_000, onHand: 9 }],
  },
  {
    name: "Switch 24 ports Gigabit",
    category: "switches",
    brand: "NetDémo",
    model: "ND-S24",
    specs: [{ label: "Ports", value: "24 × 1 Gbit/s" }],
    variants: [{ sku: "DEMO-NDS24", name: "Standard", price: 125_000, costPrice: 95_000, onHand: 2 }],
  },
  {
    name: "Câble Ethernet Cat6 20 m",
    category: "cables-ethernet",
    brand: "NetDémo",
    model: "ND-C6",
    specs: [{ label: "Catégorie", value: "Cat6" }],
    variants: [{ sku: "DEMO-C6-20", name: "20 m", price: 7_500, costPrice: 5_000, onHand: 40 }],
  },
  {
    name: "Caméra IP extérieure 4 MP",
    category: "cameras-ip",
    brand: "VigiDémo",
    model: "VG-4MP",
    isFeatured: true,
    warrantyMonths: 12,
    specs: [{ label: "Résolution", value: "4 mégapixels" }],
    variants: [{ sku: "DEMO-VG4MP", name: "Standard", price: 45_000, costPrice: 32_000, onHand: 12 }],
  },
  {
    name: "Enregistreur NVR 8 canaux",
    category: "enregistreurs-dvr-et-nvr",
    brand: "VigiDémo",
    model: "VG-NVR8",
    specs: [{ label: "Canaux", value: "8" }],
    variants: [{ sku: "DEMO-VGNVR8", name: "Standard", price: 89_000, costPrice: 65_000, onHand: 5 }],
  },
  {
    name: "Onduleur 1500 VA",
    category: "onduleurs",
    brand: "VoltDémo",
    model: "VL-1500",
    specs: [{ label: "Puissance", value: "1500 VA" }],
    variants: [{ sku: "DEMO-VL1500", name: "Standard", price: 135_000, costPrice: 100_000, onHand: 6 }],
  },
  {
    name: "Ampoule LED 12 W",
    category: "eclairage-led",
    brand: "VoltDémo",
    model: "VL-LED12",
    specs: [{ label: "Puissance", value: "12 W" }],
    variants: [{ sku: "DEMO-LED12", name: "Lot de 1", price: 1_500, costPrice: 900, onHand: 200 }],
  },
  {
    name: "Clé USB 64 Go",
    category: "cles-usb",
    brand: "DémoTech",
    model: "DT-USB64",
    specs: [{ label: "Capacité", value: "64 Go" }],
    variants: [{ sku: "DEMO-USB64", name: "64 Go", price: 6_000, costPrice: 4_000, onHand: 30 }],
  },
  {
    name: "Tablette 10 pouces (brouillon)",
    category: "tablettes",
    brand: "DémoTech",
    model: "DT-TAB10",
    status: "DRAFT",
    specs: [],
    variants: [{ sku: "DEMO-TAB10", name: "Standard", price: 120_000, costPrice: 90_000, onHand: 5 }],
  },
];

const DEMO_FAQ = [
  { question: "Comment payer ma commande ?", answer: "Uniquement en espèces, à la livraison ou au retrait en boutique." },
  { question: "Livrez-vous à domicile ?", answer: "Oui, selon les zones et frais de livraison affichés au moment de la commande." },
];

async function createDemoProduct(client: PrismaClient, product: DemoProduct): Promise<boolean> {
  const name = `${DEMO_PREFIX} ${product.name}`;
  const slug = slugify(`demo ${product.name}`);
  if (await client.product.findUnique({ where: { slug }, select: { id: true } })) return false;
  const brandSlug = slugify(product.brand);
  const brand = await client.brand.upsert({
    where: { slug: brandSlug },
    create: { name: product.brand, slug: brandSlug },
    update: {},
  });
  const category = await client.category.findUniqueOrThrow({ where: { slug: product.category } });
  const status = product.status ?? "PUBLISHED";
  await client.product.create({
    data: {
      name,
      slug,
      categoryId: category.id,
      brandId: brand.id,
      model: product.model,
      shortDescription: `${name} : produit de démonstration.`,
      description: `Fiche de démonstration, non destinée à la vente.\n\nElle illustre l'affichage d'un produit ${product.brand}.`,
      condition: product.condition ?? "NEW",
      warrantyMonths: product.warrantyMonths,
      warrantyText: product.warrantyMonths ? `Garantie de ${product.warrantyMonths} mois.` : undefined,
      specs: product.specs,
      status,
      isFeatured: product.isFeatured ?? false,
      publishedAt: status === "PUBLISHED" ? new Date() : undefined,
      variants: {
        create: product.variants.map((variant, position) => ({
          sku: variant.sku,
          name: variant.name,
          price: variant.price,
          compareAtPrice: variant.compareAtPrice,
          costPrice: variant.costPrice,
          attributes: variant.attributes ?? {},
          isDefault: position === 0,
          position,
          inventory: { create: { onHand: variant.onHand, alertThreshold: 2 } },
        })),
      },
    },
  });
  return true;
}

/** Charge la démonstration (idempotent). Prérequis : catégories de base (seedBaseCatalog). */
export async function seedDemoCatalog(client: PrismaClient): Promise<{ productsCreated: number }> {
  let productsCreated = 0;
  for (const product of DEMO_PRODUCTS) {
    if (await createDemoProduct(client, product)) productsCreated += 1;
  }

  const [router, cable] = await Promise.all([
    client.product.findUnique({ where: { slug: slugify("demo Routeur Wi-Fi 6 double bande") } }),
    client.product.findUnique({ where: { slug: slugify("demo Câble Ethernet Cat6 20 m") } }),
  ]);
  if (router && cable) {
    await client.productCompatibility.createMany({
      data: [{ productId: router.id, compatibleProductId: cable.id }],
      skipDuplicates: true,
    });
  }

  if ((await client.faqItem.count()) === 0) {
    await client.faqItem.createMany({
      data: DEMO_FAQ.map((item, position) => ({ ...item, question: `${DEMO_PREFIX} ${item.question}`, position })),
    });
  }
  return { productsCreated };
}
