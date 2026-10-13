/**
 * Génère un lien de réinitialisation de mot de passe (valable 1 heure) et l'affiche,
 * pour l'exploitant ayant accès au serveur, tant qu'aucun fournisseur e-mail n'est
 * configuré (décision D11).
 *
 * Procédure : vérifier l'identité du demandeur (rappel sur le numéro connu, présence en
 * boutique) AVANT de lancer la commande, et remettre le lien par un canal maîtrisé.
 * Pour un compte du personnel, l'option --confirmer est exigée.
 *
 * Usage : pnpm admin:reset-link <email> [--confirmer]
 */
import { userInfo } from "node:os";
import { recordAudit } from "@/server/audit/audit";
import { createAuth, type ResetLink } from "@/server/auth/auth";
import { requestPasswordReset } from "@/server/auth/service";
import { db } from "@/server/db/client";

async function main(): Promise<void> {
  const args = process.argv.slice(2);
  const email = args.find((arg) => !arg.startsWith("--"))?.trim().toLowerCase();
  if (!email) throw new Error("Usage : pnpm admin:reset-link <email> [--confirmer]");

  const user = await db.user.findUnique({
    where: { email },
    select: { id: true, isActive: true, _count: { select: { roles: true } } },
  });
  if (!user?.isActive) throw new Error("Aucun compte actif ne correspond à cet e-mail.");
  if (user._count.roles > 0 && !args.includes("--confirmer")) {
    throw new Error("Compte du personnel : vérifiez l'identité du demandeur puis relancez avec --confirmer.");
  }

  let link: ResetLink | undefined;
  const auth = createAuth({ deliverResetLink: async (generated) => void (link = generated) });
  await requestPasswordReset(auth, { email }, { headers: new Headers() });
  if (!link) throw new Error("Lien non généré (plafond de demandes atteint ? réessayez dans 15 minutes).");

  await recordAudit(db, {
    actorId: null,
    action: "auth.password_reset.cli_issue",
    entityType: "User",
    entityId: user.id,
    after: { operator: userInfo().username, staffAccount: user._count.roles > 0 },
  });
  console.info(`Lien à transmettre à l'utilisateur (valable 1 heure, usage unique) :\n${link.url}`);
}

main()
  .catch((error: unknown) => {
    console.error(error instanceof Error ? error.message : error);
    process.exitCode = 1;
  })
  .finally(() => db.$disconnect());
