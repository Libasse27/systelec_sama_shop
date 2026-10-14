import "server-only";
import type { PrismaClient } from "@/generated/prisma/client";
import { toCsv, type CsvCell } from "@/lib/csv";
import { recordAudit } from "@/server/audit/audit";
import { assertPermission, type Actor } from "@/server/authz/service";
import type { Db } from "@/server/db/client";
import { ValidationError } from "@/server/errors";
import { applyStockMovement } from "@/server/modules/inventory/service";
import {
  MAX_IMPORT_BYTES,
  PRICE_FIELDS,
  STOCK_FIELDS,
  planCatalogImport,
  type CurrentVariant,
  type ImportPlan,
} from "./csv-import-plan";

const IMPORT_TIMEOUT_MS = 120_000;
/** Détail limité dans l'audit ; les comptages restent tous tracés dans le journal de stock. */
const AUDIT_CHANGES_LIMIT = 1000;
export const IMPORT_COUNT_REASON = "Inventaire importé (CSV)";

const STATUS_LABELS = { DRAFT: "brouillon", PUBLISHED: "publié", ARCHIVED: "archivé" } as const;

/**
 * Export d'une ligne par version. Le prix d'achat n'est exporté qu'aux personnes autorisées
 * à modifier les produits ; « stock_compte » est laissé vide pour la saisie d'un inventaire.
 */
export async function exportCatalogCsv(client: Db, actor: Actor): Promise<string> {
  await assertPermission(client, actor, "products.read");
  const withCost = actor.permissions.has("products.update");
  const variants = await client.productVariant.findMany({
    orderBy: [{ product: { name: "asc" } }, { position: "asc" }, { id: "asc" }],
    select: {
      sku: true,
      name: true,
      price: true,
      compareAtPrice: true,
      costPrice: true,
      isActive: true,
      inventory: { select: { onHand: true, reserved: true, alertThreshold: true } },
      product: { select: { name: true, status: true, category: { select: { slug: true } }, brand: { select: { name: true } } } },
    },
  });
  const header = [
    "sku",
    "produit",
    "version",
    "categorie",
    "marque",
    "statut",
    "version_active",
    "prix",
    "prix_barre",
    ...(withCost ? ["prix_achat"] : []),
    "seuil_alerte",
    "stock_physique",
    "stock_reserve",
    "stock_compte",
  ];
  const rows: CsvCell[][] = variants.map((variant) => [
    variant.sku,
    variant.product.name,
    variant.name,
    variant.product.category.slug,
    variant.product.brand?.name,
    STATUS_LABELS[variant.product.status],
    variant.isActive ? "oui" : "non",
    variant.price,
    variant.compareAtPrice,
    ...(withCost ? [variant.costPrice] : []),
    variant.inventory?.alertThreshold ?? 0,
    variant.inventory?.onHand ?? 0,
    variant.inventory?.reserved ?? 0,
    null,
  ]);
  return toCsv([header, ...rows]);
}

async function loadCurrentVariants(client: Db): Promise<Map<string, CurrentVariant>> {
  const variants = await client.productVariant.findMany({
    select: {
      id: true,
      sku: true,
      price: true,
      compareAtPrice: true,
      costPrice: true,
      inventory: { select: { onHand: true, reserved: true, alertThreshold: true } },
    },
  });
  return new Map(
    variants.map((variant) => [
      variant.sku,
      {
        variantId: variant.id,
        price: variant.price,
        compareAtPrice: variant.compareAtPrice,
        costPrice: variant.costPrice,
        onHand: variant.inventory?.onHand ?? 0,
        reserved: variant.inventory?.reserved ?? 0,
        alertThreshold: variant.inventory?.alertThreshold ?? 0,
      },
    ]),
  );
}

function assertImportSize(text: string): void {
  if (Buffer.byteLength(text, "utf8") > MAX_IMPORT_BYTES) {
    throw new ValidationError("Fichier trop volumineux (2 Mo maximum).");
  }
}

/**
 * Les permissions requises dépendent des changements réellement demandés. Le prix d'achat,
 * confidentiel, exige le droit dès que la colonne est remplie : sinon l'aperçu (« inchangé »)
 * permettrait de deviner sa valeur.
 */
async function assertImportPermissions(client: Db, actor: Actor, plan: ImportPlan): Promise<void> {
  if (plan.filledFields.includes("costPrice")) await assertPermission(client, actor, "products.update");
  const touches = (fields: readonly string[]) => plan.changes.some((change) => fields.some((field) => field in change.fields));
  if (touches(PRICE_FIELDS)) await assertPermission(client, actor, "products.update");
  if (touches(STOCK_FIELDS)) await assertPermission(client, actor, "inventory.adjust");
}

/** Aperçu de l'import : changements détectés et erreurs, sans aucune écriture. */
export async function previewCatalogImport(client: Db, actor: Actor, text: string): Promise<ImportPlan> {
  await assertPermission(client, actor, "products.read");
  assertImportSize(text);
  const plan = planCatalogImport(text, await loadCurrentVariants(client));
  await assertImportPermissions(client, actor, plan);
  return plan;
}

/**
 * Applique l'import en une seule transaction : tout ou rien. Le plan est recalculé dans la
 * transaction, sur l'état courant ; une seule ligne en erreur annule l'ensemble.
 * Les quantités comptées passent par des mouvements d'inventaire motivés (journal de stock).
 */
export async function applyCatalogImport(client: PrismaClient, actor: Actor, text: string): Promise<{ updated: number }> {
  await assertPermission(client, actor, "products.read");
  assertImportSize(text);
  return client.$transaction(
    async (tx) => {
      // Verrou consultatif : deux imports simultanés s'exécutent l'un après l'autre.
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext('catalog-import'))`;
      const plan = planCatalogImport(text, await loadCurrentVariants(tx));
      if (plan.errors.length > 0) throw new ValidationError("L'import contient des erreurs : rien n'a été modifié.", { errors: plan.errors });
      await assertImportPermissions(tx, actor, plan);

      for (const { variantId, fields } of plan.changes) {
        const prices = Object.fromEntries(PRICE_FIELDS.filter((field) => field in fields).map((field) => [field, fields[field]!.to]));
        if (Object.keys(prices).length > 0) await tx.productVariant.update({ where: { id: variantId }, data: prices });
        if (fields.alertThreshold) {
          await tx.inventory.upsert({
            where: { variantId },
            create: { variantId, alertThreshold: fields.alertThreshold.to! },
            update: { alertThreshold: fields.alertThreshold.to! },
          });
        }
        if (fields.counted) {
          await applyStockMovement(tx, actor.id, {
            type: "ADJUSTMENT",
            variantId,
            countedQuantity: fields.counted.to!,
            reason: IMPORT_COUNT_REASON,
          });
        }
      }
      await recordAudit(tx, {
        actorId: actor.id,
        action: "catalog.import",
        entityType: "ProductVariant",
        after: { updated: plan.changes.length, changes: plan.changes.slice(0, AUDIT_CHANGES_LIMIT), truncated: plan.changes.length > AUDIT_CHANGES_LIMIT },
      });
      return { updated: plan.changes.length };
    },
    { timeout: IMPORT_TIMEOUT_MS },
  );
}
