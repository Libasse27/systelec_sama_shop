import "server-only";
import type { Db } from "@/server/db/client";

export type SequenceKey = "order" | "quote" | "quote_request" | "intervention" | "receipt" | "invoice" | "return" | "contact_message";

export const SEQUENCE_PREFIXES: Record<SequenceKey, string> = {
  order: "CMD",
  quote: "DEV",
  quote_request: "DDE",
  intervention: "INT",
  receipt: "REC",
  invoice: "FAC",
  return: "RET",
  contact_message: "MSG",
};

/**
 * Incrément atomique (INSERT … ON CONFLICT … RETURNING) : sûr en cas d'appels
 * concurrents. À appeler dans la transaction qui crée le document numéroté.
 */
export async function nextSequenceValue(client: Db, key: SequenceKey, year: number): Promise<number> {
  const rows = await client.$queryRaw<{ value: number }[]>`
    INSERT INTO sequences (key, year, value) VALUES (${key}, ${year}, 1)
    ON CONFLICT (key, year) DO UPDATE SET value = sequences.value + 1
    RETURNING value`;
  const value = rows[0]?.value;
  if (value === undefined) throw new Error(`Séquence ${key}/${year} non incrémentée`);
  return value;
}

export function formatBusinessNumber(key: SequenceKey, year: number, value: number): string {
  return `${SEQUENCE_PREFIXES[key]}-${year}-${String(value).padStart(6, "0")}`;
}

export async function nextBusinessNumber(client: Db, key: SequenceKey, year: number): Promise<string> {
  return formatBusinessNumber(key, year, await nextSequenceValue(client, key, year));
}
