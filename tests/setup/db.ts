import { db } from "@/server/db/client";

/**
 * Vide les tables entre deux tests. TRUNCATE n'est pas bloqué par le trigger
 * append-only de audit_logs (qui vise UPDATE/DELETE) ; en production, le rôle
 * applicatif ne doit pas disposer du privilège TRUNCATE (voir docs).
 */
export async function resetDatabase(): Promise<void> {
  await db.$executeRawUnsafe("TRUNCATE site_settings, sequences, audit_logs RESTART IDENTITY CASCADE");
}
