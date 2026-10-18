import "server-only";
import type { Db } from "@/server/db/client";
import { AppError } from "@/server/errors";

/**
 * Limites anti-abus de la prise de commande : une commande bloque du stock pendant le délai
 * de réservation, un robot ne doit pas pouvoir immobiliser tout le catalogue.
 */
export const ORDER_LIMITS = {
  /** Commandes créées depuis une même IP sur la fenêtre. */
  perIp: 10,
  windowMinutes: 60,
  /** Commandes en attente de confirmation pour un même numéro de téléphone. */
  pendingPerPhone: 3,
} as const;

export async function assertOrderAllowed(client: Db, ip: string | undefined, phone: string): Promise<void> {
  if (ip) {
    const since = new Date(Date.now() - ORDER_LIMITS.windowMinutes * 60_000);
    const recent = await client.auditLog.count({ where: { action: "order.create", ip, createdAt: { gte: since } } });
    if (recent >= ORDER_LIMITS.perIp) {
      throw new AppError("RATE_LIMITED", "Trop de commandes depuis cette connexion. Réessayez plus tard ou appelez-nous.");
    }
  }
  // Comparaison sur les seuls chiffres : « 77 123 45 67 » et « 771234567 » sont le même numéro.
  const digits = phone.replace(/\D/g, "");
  const [pending] = await client.$queryRaw<{ count: number }[]>`
    SELECT COUNT(*)::int AS count FROM orders o JOIN customers c ON c.id = o."customerId"
    WHERE o.status = 'PENDING_CONFIRMATION' AND regexp_replace(c.phone, '\\D', '', 'g') = ${digits}`;
  if ((pending?.count ?? 0) >= ORDER_LIMITS.pendingPerPhone) {
    throw new AppError(
      "RATE_LIMITED",
      `Vous avez déjà ${ORDER_LIMITS.pendingPerPhone} commandes en attente de confirmation. Nous vous appelons pour les confirmer.`,
    );
  }
}
