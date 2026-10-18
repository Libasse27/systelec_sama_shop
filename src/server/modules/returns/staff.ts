import "server-only";
import type { Db } from "@/server/db/client";
import { SUPER_ADMIN } from "@/server/authz/roles";

/** Rôles alertés sur les retours en retard (traitement non commencé, vérification sans réponse). */
const ALERTED_ROLES = [SUPER_ADMIN, "ADMIN"] as const;

/** Administrateurs actifs joignables (e-mail ou téléphone), les plus anciens d'abord. */
export async function activeAdmins(client: Db): Promise<{ email: string; phone: string | null }[]> {
  const admins = await client.user.findMany({
    where: { isActive: true, roles: { some: { role: { code: { in: [...ALERTED_ROLES] } } } } },
    orderBy: { createdAt: "asc" },
    select: { email: true, phone: true },
  });
  return admins.filter((admin) => admin.email || admin.phone);
}
