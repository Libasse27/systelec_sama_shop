/**
 * Import CSV du catalogue : mise à jour en masse des prix, seuils d'alerte et quantités comptées
 * des versions EXISTANTES, repérées par leur SKU. Aucune création ni suppression par import.
 * Une cellule vide laisse la valeur inchangée ; « 0 » en prix_barre retire le prix barré.
 */
import { parseCsv } from "@/lib/csv";

export const MAX_IMPORT_ROWS = 5000;
export const MAX_IMPORT_BYTES = 2 * 1024 * 1024;
const MAX_AMOUNT = 100_000_000;
const MAX_QUANTITY = 1_000_000;
const MAX_REPORTED_ERRORS = 50;

export const PRICE_FIELDS = ["price", "compareAtPrice", "costPrice"] as const;
export const STOCK_FIELDS = ["alertThreshold", "counted"] as const;
export type ImportField = (typeof PRICE_FIELDS)[number] | (typeof STOCK_FIELDS)[number];

/** En-têtes du fichier (ceux de l'export) → champ mis à jour. Les autres colonnes sont ignorées. */
export const IMPORT_COLUMNS: Record<string, ImportField> = {
  prix: "price",
  prix_barre: "compareAtPrice",
  prix_achat: "costPrice",
  seuil_alerte: "alertThreshold",
  stock_compte: "counted",
};

export interface CurrentVariant {
  variantId: string;
  price: number;
  compareAtPrice: number | null;
  costPrice: number | null;
  alertThreshold: number;
  onHand: number;
  reserved: number;
}

export interface ImportChange {
  line: number;
  sku: string;
  variantId: string;
  fields: Partial<Record<ImportField, { from: number | null; to: number | null }>>;
}

export interface ImportPlan {
  changes: ImportChange[];
  errors: { line: number; message: string }[];
  /** Lignes valides sans aucun changement. */
  unchanged: number;
  /** Colonnes ayant au moins une valeur, changée ou non (contrôle des droits sans oracle). */
  filledFields: ImportField[];
}

const normalizeHeader = (value: string) =>
  value
    .trim()
    .toLowerCase()
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/[\s-]+/g, "_");

/** Entier positif ou nul, espaces de milliers tolérés ; undefined si la cellule est vide. */
function parseAmount(raw: string | undefined, max: number): number | undefined | "invalid" {
  const text = (raw ?? "").replace(/[\s  ]/g, "");
  if (text === "") return undefined;
  if (!/^\d+$/.test(text)) return "invalid";
  const value = Number(text);
  return value <= max ? value : "invalid";
}

const LABELS: Record<ImportField, string> = {
  price: "prix",
  compareAtPrice: "prix_barre",
  costPrice: "prix_achat",
  alertThreshold: "seuil_alerte",
  counted: "stock_compte",
};

type RowResult = { errors: string[] } | { change: Omit<ImportChange, "sku"> };

function planRow(cells: string[], line: number, columns: Map<ImportField, number>, current: CurrentVariant): RowResult {
  const values: Partial<Record<ImportField, number>> = {};
  const errors: string[] = [];
  for (const [field, index] of columns) {
    const value = parseAmount(cells[index], field === "alertThreshold" || field === "counted" ? MAX_QUANTITY : MAX_AMOUNT);
    if (value === "invalid") errors.push(`${LABELS[field]} : nombre entier positif attendu`);
    else if (value !== undefined) values[field] = value;
  }
  if (errors.length > 0) return { errors };

  const next = {
    price: values.price ?? current.price,
    compareAtPrice: values.compareAtPrice === undefined ? current.compareAtPrice : values.compareAtPrice || null,
    costPrice: values.costPrice ?? current.costPrice,
    alertThreshold: values.alertThreshold ?? current.alertThreshold,
    counted: values.counted ?? current.onHand,
  };
  if (next.compareAtPrice !== null && next.compareAtPrice <= next.price) {
    return { errors: ["le prix barré doit être supérieur au prix de vente (0 pour le retirer)"] };
  }
  if (next.counted < current.reserved) {
    return { errors: [`quantité comptée inférieure au stock réservé (${current.reserved})`] };
  }
  const before = { ...current, counted: current.onHand };
  const fields: ImportChange["fields"] = {};
  for (const field of [...PRICE_FIELDS, ...STOCK_FIELDS]) {
    if (next[field] !== before[field]) fields[field] = { from: before[field], to: next[field] };
  }
  return { change: { line, variantId: current.variantId, fields } };
}

/** Analyse le fichier et calcule les changements par rapport à l'état actuel, sans rien écrire. */
export function planCatalogImport(text: string, currentBySku: ReadonlyMap<string, CurrentVariant>): ImportPlan {
  let rows: string[][];
  try {
    rows = parseCsv(text);
  } catch (error) {
    return { changes: [], errors: [{ line: 0, message: error instanceof Error ? error.message : "Fichier illisible." }], unchanged: 0, filledFields: [] };
  }
  const [header, ...data] = rows;
  const headers = (header ?? []).map(normalizeHeader);
  const skuIndex = headers.indexOf("sku");
  if (skuIndex === -1) return { changes: [], errors: [{ line: 1, message: "Colonne « sku » introuvable." }], unchanged: 0, filledFields: [] };
  const columns = new Map<ImportField, number>();
  headers.forEach((name, index) => {
    const field = IMPORT_COLUMNS[name];
    if (field && !columns.has(field)) columns.set(field, index);
  });
  if (columns.size === 0) {
    return { changes: [], errors: [{ line: 1, message: "Aucune colonne modifiable (prix, prix_barre, prix_achat, seuil_alerte, stock_compte)." }], unchanged: 0, filledFields: [] };
  }
  if (data.length > MAX_IMPORT_ROWS) {
    return { changes: [], errors: [{ line: 0, message: `${MAX_IMPORT_ROWS} lignes au maximum par import.` }], unchanged: 0, filledFields: [] };
  }

  const plan: ImportPlan = { changes: [], errors: [], unchanged: 0, filledFields: [] };
  plan.filledFields = [...columns].filter(([, index]) => data.some((cells) => (cells[index] ?? "").trim() !== "")).map(([field]) => field);
  const seen = new Set<string>();
  data.forEach((cells, index) => {
    // Numéro de ligne approximatif si le fichier contient des lignes vides (ignorées à la lecture).
    const line = index + 2;
    const sku = (cells[skuIndex] ?? "").trim().toUpperCase();
    const fail = (message: string): void => {
      if (plan.errors.length < MAX_REPORTED_ERRORS) plan.errors.push({ line, message: `${sku || "?"} : ${message}` });
    };
    if (!sku) return fail("SKU manquant");
    if (seen.has(sku)) return fail("SKU présent plusieurs fois dans le fichier");
    seen.add(sku);
    const current = currentBySku.get(sku);
    if (!current) return fail("référence inconnue (l'import ne crée pas de produit)");
    const result = planRow(cells, line, columns, current);
    if ("errors" in result) return result.errors.forEach(fail);
    if (Object.keys(result.change.fields).length === 0) plan.unchanged += 1;
    else plan.changes.push({ ...result.change, sku });
  });
  return plan;
}
