import "server-only";
import { betterAuth, type BetterAuthPlugin } from "better-auth";
import { prismaAdapter } from "better-auth/adapters/prisma";
import { nextCookies } from "better-auth/next-js";
import { BRAND } from "@/lib/brand";
import { getServerEnv } from "@/lib/env";
import { recordAudit } from "@/server/audit/audit";
import { db } from "@/server/db/client";
import { logger } from "@/server/logger";
import { sendEmail } from "@/server/notifications/mailer";
import { PASSWORD_MAX_LENGTH, PASSWORD_MIN_LENGTH } from "./schemas";

export const RESET_PASSWORD_PATH = "/reinitialiser-mot-de-passe";
const SESSION_DAYS = 7;
const RESET_TOKEN_SECONDS = 60 * 60;

export interface ResetLink {
  email: string;
  url: string;
}

export interface CreateAuthOptions {
  /** Ajoute la gestion des cookies Next.js (Server Actions). Désactivé en tests et en CLI. */
  withNextCookies?: boolean;
  /** Destination du lien de réinitialisation ; par défaut, envoi par e-mail. */
  deliverResetLink?: (link: ResetLink) => Promise<void>;
}

async function emailResetLink({ email, url }: ResetLink): Promise<void> {
  await sendEmail({
    to: email,
    subject: "Réinitialisation de votre mot de passe",
    text: `Pour choisir un nouveau mot de passe, ouvrez ce lien (valable 1 heure) :\n${url}\n\nSi vous n'êtes pas à l'origine de cette demande, ignorez ce message.`,
  });
}

/**
 * Configuration Better Auth. Aucune route HTTP Better Auth n'est exposée : toutes les
 * opérations passent par src/server/auth/service.ts, qui les valide et les journalise.
 */
export function createAuth({ withNextCookies = false, deliverResetLink = emailResetLink }: CreateAuthOptions = {}) {
  const env = getServerEnv();
  const plugins: BetterAuthPlugin[] = withNextCookies ? [nextCookies()] : [];

  return betterAuth({
    appName: BRAND.shop.name,
    baseURL: env.APP_URL,
    secret: env.AUTH_SECRET,
    database: prismaAdapter(db, { provider: "postgresql" }),
    emailAndPassword: {
      enabled: true,
      minPasswordLength: PASSWORD_MIN_LENGTH,
      maxPasswordLength: PASSWORD_MAX_LENGTH,
      autoSignIn: true,
      revokeSessionsOnPasswordReset: true,
      resetPasswordTokenExpiresIn: RESET_TOKEN_SECONDS,
      // Lien vers notre page (et non vers la route HTTP Better Auth, non exposée).
      // Envoi non attendu : la réponse ne doit pas durer plus longtemps quand le compte existe (le temps
      // d'un échange SMTP révélerait son existence). Un échec est journalisé, jamais signalé au demandeur.
      sendResetPassword: async ({ user, token }) => {
        deliverResetLink({ email: user.email, url: `${env.APP_URL}${RESET_PASSWORD_PATH}?token=${encodeURIComponent(token)}` }).catch((error: unknown) =>
          logger.error("Lien de réinitialisation non envoyé", { error: error instanceof Error ? error.message : "inconnue" }),
        );
      },
      // Journalisé ici car c'est le seul point où le compte concerné est connu.
      onPasswordReset: async ({ user }) =>
        recordAudit(db, { actorId: user.id, action: "auth.password_reset", entityType: "User", entityId: user.id }),
    },
    user: {
      additionalFields: {
        phone: { type: "string", required: false },
        // Jamais saisissables par le client : le personnel est promu par attribution de rôle.
        kind: { type: "string", required: false, input: false, defaultValue: "CUSTOMER" },
        isActive: { type: "boolean", required: false, input: false, defaultValue: true },
      },
    },
    session: {
      expiresIn: SESSION_DAYS * 24 * 60 * 60,
      updateAge: 24 * 60 * 60,
    },
    databaseHooks: {
      session: {
        create: {
          // Un compte désactivé ne peut ouvrir aucune session.
          before: async (session) => {
            const user = await db.user.findUnique({ where: { id: session.userId }, select: { isActive: true } });
            return user?.isActive === true;
          },
        },
      },
    },
    advanced: { useSecureCookies: env.APP_ENV === "production" },
    plugins,
  });
}

export type Auth = ReturnType<typeof createAuth>;

const globalForAuth = globalThis as unknown as { auth?: Auth };

/** Instance de l'application (cookies Next.js activés). */
export function getAuth(): Auth {
  globalForAuth.auth ??= createAuth({ withNextCookies: true });
  return globalForAuth.auth;
}
