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
import { reconcileAfterPasswordReset } from "./social-accounts";
import { createSocialPolicy } from "./social-policy";
import { buildSocialProviders, type SocialEnv } from "./social-providers";

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
  /** Identifiants des fournisseurs de connexion sociale ; par défaut, ceux de la configuration serveur. */
  socialEnv?: SocialEnv;
  /** Réconciliation après réinitialisation (e-mail vérifié, comptes sociaux détachés) ; injectable en test. */
  reconcileAfterReset?: (userId: string) => Promise<void>;
}

async function emailResetLink({ email, url }: ResetLink): Promise<void> {
  await sendEmail({
    to: email,
    subject: "Réinitialisation de votre mot de passe",
    text: `Pour choisir un nouveau mot de passe, ouvrez ce lien (valable 1 heure) :\n${url}\n\nSi vous n'êtes pas à l'origine de cette demande, ignorez ce message.`,
  });
}

const errorName = (error: unknown): string => (error instanceof Error ? error.name : "inconnue");

/**
 * Configuration Better Auth. Une seule route HTTP Better Auth est exposée : le retour des fournisseurs de
 * connexion sociale (src/app/api/auth/callback/[provider]/route.ts, fournisseurs actifs uniquement). Toutes
 * les autres opérations passent par src/server/auth/service.ts, qui les valide et les journalise.
 */
export function createAuth({
  withNextCookies = false,
  deliverResetLink = emailResetLink,
  socialEnv,
  reconcileAfterReset = (userId) => reconcileAfterPasswordReset(db, userId),
}: CreateAuthOptions = {}) {
  const env = getServerEnv();
  const plugins: BetterAuthPlugin[] = withNextCookies ? [nextCookies()] : [];
  const social = createSocialPolicy({ client: db, trustedProxyHops: env.TRUSTED_PROXY_HOPS });

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
      // Journalisé ici car c'est le seul point où le compte concerné est connu. La réconciliation est rejouée
      // par resetPassword (service.ts) : un échec ici est journalisé (sans donnée personnelle) puis rattrapé.
      onPasswordReset: async ({ user }) => {
        try {
          await reconcileAfterReset(user.id);
        } catch (error) {
          logger.error("Réconciliation après réinitialisation échouée (reprise par le service)", { error: errorName(error) });
        }
        await recordAudit(db, { actorId: user.id, action: "auth.password_reset", entityType: "User", entityId: user.id });
      },
    },
    // Connexion sociale (clients uniquement, voir social-policy.ts) : inerte sans identifiants configurés.
    socialProviders: buildSocialProviders(socialEnv ?? env),
    account: {
      // Aucun jeton OAuth conservé (effacés aussi par les hooks) : rien à rafraîchir à la connexion.
      updateAccountOnSignIn: false,
      accountLinking: {
        enabled: true,
        // Liaison automatique seulement si le fournisseur atteste l'e-mail ET que l'e-mail local est vérifié
        // (requireLocalEmailVerified, laissé à sa valeur par défaut : true).
        trustedProviders: [],
        allowDifferentEmails: false,
        updateUserInfoOnLink: false,
      },
    },
    // Erreurs du retour OAuth : vers notre page de connexion (message choisi par code, social-errors.ts).
    onAPIError: { errorURL: `${env.APP_URL}/connexion` },
    user: {
      validateUserInfo: social.validateUserInfo,
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
    // Compte désactivé : aucune session. Personnel : aucun compte, aucune session via un fournisseur.
    // Jetons OAuth et avatar jamais conservés.
    databaseHooks: social.databaseHooks,
    // Journal Better Auth : erreurs seulement, et le message seul (jamais les objets joints : état OAuth,
    // erreurs du fournisseur, profils), via le journal structuré de l'application.
    logger: {
      level: "error",
      log: (_level, message) => logger.error("Better Auth", { message }),
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
