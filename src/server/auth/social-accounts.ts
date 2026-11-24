import "server-only";
import type { PrismaClient } from "@/generated/prisma/client";
import { recordAudit } from "@/server/audit/audit";
import type { Db } from "@/server/db/client";

/** Fournisseur Better Auth des comptes e-mail + mot de passe ; tous les autres sont des comptes sociaux. */
export const CREDENTIAL_PROVIDER = "credential";

const socialAccountsOf = (userId: string) => ({ userId, providerId: { not: CREDENTIAL_PROVIDER } });

/** Supprime les comptes sociaux d'un utilisateur ; retourne les fournisseurs détachés (vide : rien à faire). */
export async function detachSocialAccounts(tx: Db, userId: string): Promise<readonly string[]> {
  const social = await tx.account.findMany({ where: socialAccountsOf(userId), select: { providerId: true } });
  if (social.length === 0) return [];
  await tx.account.deleteMany({ where: socialAccountsOf(userId) });
  return social.map((account) => account.providerId);
}

/**
 * Après une réinitialisation réussie (e-mail prouvé par le lien reçu), en une transaction et de façon
 * idempotente : e-mail marqué vérifié, comptes sociaux détachés (l'un a pu être créé par un tiers avant
 * cette preuve) et, s'il y en avait, sessions révoquées. Un second passage ne change ni ne journalise rien.
 */
export async function reconcileAfterPasswordReset(client: PrismaClient, userId: string): Promise<void> {
  await client.$transaction(async (tx) => {
    const user = await tx.user.findUnique({ where: { id: userId }, select: { emailVerified: true } });
    if (!user) return;
    const audit = { actorId: userId, entityType: "User", entityId: userId } as const;
    if (!user.emailVerified) {
      await tx.user.update({ where: { id: userId }, data: { emailVerified: true } });
      await recordAudit(tx, { ...audit, action: "auth.email_verified", after: { method: "password_reset" } });
    }
    const providers = await detachSocialAccounts(tx, userId);
    if (providers.length === 0) return;
    await tx.session.deleteMany({ where: { userId } });
    await recordAudit(tx, { ...audit, action: "auth.social.unlink", after: { providers, reason: "password_reset" } });
  });
}
