/**
 * Création du PREMIER administrateur principal. Le mot de passe est saisi au clavier
 * (masqué), jamais passé en argument ni écrit dans le code. Refuse s'il en existe déjà un :
 * les suivants se créent depuis l'administration. Usage : pnpm admin:create
 */
import { userInfo } from "node:os";
import { z } from "zod";
import { recordAudit } from "@/server/audit/audit";
import { createAuth } from "@/server/auth/auth";
import { signUpSchema } from "@/server/auth/schemas";
import { SUPER_ADMIN } from "@/server/authz/roles";
import { syncRolesAndPermissions } from "@/server/authz/sync";
import { db } from "@/server/db/client";
import { ask } from "./lib/prompt";

async function assertNoActiveSuperAdmin(): Promise<void> {
  const existing = await db.userRole.count({ where: { role: { code: SUPER_ADMIN }, user: { isActive: true } } });
  if (existing > 0) {
    throw new Error("Un administrateur principal actif existe déjà. Créez les comptes suivants depuis l'administration.");
  }
}

async function readInput(): Promise<z.infer<typeof signUpSchema>> {
  const name = await ask("Nom complet : ");
  const email = await ask("E-mail : ");
  const password = await ask("Mot de passe (10 caractères minimum, masqué) : ", { secret: true });
  const confirmation = await ask("Confirmez le mot de passe : ", { secret: true });
  if (password !== confirmation) throw new Error("Les mots de passe ne correspondent pas.");
  const parsed = signUpSchema.safeParse({ name, email, password });
  if (!parsed.success) throw new Error(z.prettifyError(parsed.error));
  return parsed.data;
}

/** Promeut le compte créé ; sérialisé par verrou pour empêcher deux amorçages concurrents. */
async function promote(userId: string, email: string): Promise<void> {
  await db.$transaction(async (tx) => {
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext('bootstrap:super-admin'))`;
    const role = await tx.role.findUniqueOrThrow({ where: { code: SUPER_ADMIN } });
    const existing = await tx.userRole.count({ where: { roleId: role.id, user: { isActive: true } } });
    if (existing > 0) throw new Error("Un administrateur principal a été créé entre-temps.");
    await tx.user.update({ where: { id: userId }, data: { kind: "STAFF", emailVerified: true } });
    await tx.userRole.create({ data: { userId, roleId: role.id } });
    // La session ouverte automatiquement à l'inscription n'a pas lieu d'être en CLI.
    await tx.session.deleteMany({ where: { userId } });
    await recordAudit(tx, {
      actorId: null,
      action: "rbac.super_admin.bootstrap",
      entityType: "User",
      entityId: userId,
      after: { email, role: SUPER_ADMIN, operator: userInfo().username },
    });
  });
}

async function main(): Promise<void> {
  await syncRolesAndPermissions(db);
  await assertNoActiveSuperAdmin();
  const input = await readInput();
  if (await db.user.findUnique({ where: { email: input.email } })) {
    throw new Error("Un compte existe déjà avec cet e-mail.");
  }

  const { user } = await createAuth().api.signUpEmail({
    body: { name: input.name, email: input.email, password: input.password },
  });
  try {
    await promote(user.id, input.email);
  } catch (error) {
    // Pas de compte client orphelin portant l'e-mail de l'administrateur.
    await db.user.delete({ where: { id: user.id } });
    throw error;
  }
  console.info(`Administrateur principal créé : ${input.email}. Connectez-vous sur /connexion.`);
}

main()
  .catch((error: unknown) => {
    console.error(error instanceof Error ? error.message : error);
    process.exitCode = 1;
  })
  .finally(() => db.$disconnect());
