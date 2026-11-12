import "server-only";
import { isAPIError } from "better-auth/api";
import { z } from "zod";
import type { UserKind } from "@/generated/prisma/client";
import { recordAudit } from "@/server/audit/audit";
import { db } from "@/server/db/client";
import { getServerEnv } from "@/lib/env";
import { safeRedirectPath } from "@/lib/redirect";
import { AppError, ValidationError } from "@/server/errors";
import { logger } from "@/server/logger";
import type { Auth } from "./auth";
import {
  isLoginBlocked,
  isResetRequestBlocked,
  isSignupBlocked,
  isSocialStartBlocked,
  shouldRecordDenial,
  SOCIAL_START_ACTION,
  WINDOW_MINUTES,
} from "./limits";
import { reconcileAfterPasswordReset } from "./social-accounts";
import { passwordResetRequestSchema, passwordResetSchema, signInSchema, signUpSchema } from "./schemas";
import { isExpectedAuthorizationURL, SOCIAL_PROVIDER_IDS, type SocialProviderId } from "./social-providers";

export interface RequestContext {
  headers: Headers;
  /** IP fiable du client (voir client-ip.ts), absente sans reverse proxy de confiance. */
  ip?: string;
}

const TOO_MANY_ATTEMPTS = `Trop de tentatives. Réessayez dans ${WINDOW_MINUTES} minutes.`;

function parse<T extends z.ZodType>(schema: T, input: unknown): z.infer<T> {
  const parsed = schema.safeParse(input);
  if (!parsed.success) throw new ValidationError("Formulaire invalide", z.flattenError(parsed.error as z.ZodError));
  return parsed.data;
}

/** Crée un compte client (jamais un compte du personnel) et ouvre sa session. */
export async function signUpCustomer(auth: Auth, input: unknown, ctx: RequestContext): Promise<{ userId: string }> {
  const { name, email, phone, password } = parse(signUpSchema, input);
  if (await isSignupBlocked(db, ctx.ip)) throw new AppError("RATE_LIMITED", TOO_MANY_ATTEMPTS);
  try {
    const result = await auth.api.signUpEmail({ body: { name, email, password, phone }, headers: ctx.headers });
    await recordAudit(db, {
      actorId: result.user.id,
      action: "auth.signup",
      entityType: "User",
      entityId: result.user.id,
      ip: ctx.ip,
    });
    return { userId: result.user.id };
  } catch (error) {
    if (!isAPIError(error)) throw error;
    await recordAudit(db, {
      actorId: null,
      action: "auth.signup",
      entityType: "SignupAttempt",
      entityId: email,
      result: "FAILURE",
      ip: ctx.ip,
    });
    throw new AppError(
      "CONFLICT",
      "Impossible de créer ce compte. Si vous avez déjà un compte, connectez-vous ou réinitialisez votre mot de passe.",
    );
  }
}

/**
 * Réserve une tentative de connexion : contrôle du plafond et enregistrement de la tentative
 * (en cours) sous verrou par e-mail. Transaction courte, sans appel externe : des requêtes
 * parallèles ne peuvent pas dépasser le plafond ni épuiser le pool de connexions.
 */
async function reserveLoginAttempt(email: string, ip: string | undefined): Promise<string | null> {
  return db.$transaction(async (tx) => {
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${`login:${email}`}))`;
    if (await isLoginBlocked(tx, email, ip)) {
      if (await shouldRecordDenial(tx, "auth.login", email)) {
        await recordAudit(tx, {
          actorId: null,
          action: "auth.login",
          entityType: "LoginAttempt",
          entityId: email,
          result: "DENIED",
          ip,
        });
      }
      return null;
    }
    const attempt = await tx.loginAttempt.create({ data: { email, ip }, select: { id: true } });
    return attempt.id;
  });
}

/** Connexion par e-mail et mot de passe, journalisée et limitée en nombre de tentatives. */
export async function signIn(auth: Auth, input: unknown, ctx: RequestContext): Promise<{ userId: string; kind: UserKind }> {
  const { email, password } = parse(signInSchema, input);
  const attemptId = await reserveLoginAttempt(email, ctx.ip);
  if (!attemptId) throw new AppError("RATE_LIMITED", TOO_MANY_ATTEMPTS);
  const audit = { action: "auth.login", entityType: "LoginAttempt", entityId: email, ip: ctx.ip } as const;

  let userId: string;
  try {
    userId = (await auth.api.signInEmail({ body: { email, password }, headers: ctx.headers })).user.id;
  } catch (error) {
    await db.loginAttempt.update({ where: { id: attemptId }, data: { status: "FAILURE" } });
    if (!isAPIError(error)) throw error;
    await recordAudit(db, { ...audit, actorId: null, result: "FAILURE" });
    throw new AppError("UNAUTHENTICATED", "E-mail ou mot de passe incorrect.");
  }

  const user = await db.$transaction(async (tx) => {
    await tx.loginAttempt.update({ where: { id: attemptId }, data: { status: "SUCCESS" } });
    await recordAudit(tx, { ...audit, actorId: userId });
    return tx.user.findUniqueOrThrow({ where: { id: userId }, select: { kind: true } });
  });
  return { userId, kind: user.kind };
}

/** Déconnexion : révoque la session en base. */
export async function signOut(auth: Auth, ctx: RequestContext): Promise<void> {
  const session = await auth.api.getSession({ headers: ctx.headers });
  if (!session) return;
  await auth.api.signOut({ headers: ctx.headers });
  await recordAudit(db, {
    actorId: session.user.id,
    action: "auth.logout",
    entityType: "User",
    entityId: session.user.id,
    ip: ctx.ip,
  });
}

/**
 * Demande de réinitialisation. La réponse est toujours neutre (aucune information sur
 * l'existence du compte). Au-delà du plafond, la demande est ignorée silencieusement.
 */
export async function requestPasswordReset(auth: Auth, input: unknown, ctx: RequestContext): Promise<void> {
  const { email } = parse(passwordResetRequestSchema, input);
  if (await isResetRequestBlocked(db, email, ctx.ip)) return;
  try {
    await auth.api.requestPasswordReset({ body: { email }, headers: ctx.headers });
  } catch (error) {
    logger.error("Échec de la demande de réinitialisation", {
      error: error instanceof Error ? error.message : "inconnue",
    });
  }
  await recordAudit(db, {
    actorId: null,
    action: "auth.password_reset.request",
    entityType: "PasswordResetRequest",
    entityId: email,
    ip: ctx.ip,
  });
}

/** Réconciliation après réinitialisation (injectable en test). */
export type ResetReconciler = (client: typeof db, userId: string) => Promise<unknown>;

const errorName = (error: unknown): string => (error instanceof Error ? error.name : "inconnue");

/** Compte visé par le jeton, lu avant sa consommation ; une panne de lecture n'empêche pas la réinitialisation. */
async function resetTokenUserId(auth: Auth, token: string): Promise<string | null> {
  try {
    const verification = await (await auth.$context).internalAdapter.findVerificationValue(`reset-password:${token}`);
    return verification?.value ?? null;
  } catch (error) {
    logger.error("Lecture du jeton de réinitialisation échouée", { error: errorName(error) });
    return null;
  }
}

/**
 * Choix d'un nouveau mot de passe à partir du lien reçu ; toutes les sessions sont révoquées.
 * Le succès est journalisé avec le compte concerné par le rappel onPasswordReset (auth.ts).
 */
export async function resetPassword(
  auth: Auth,
  input: unknown,
  ctx: RequestContext,
  reconcile: ResetReconciler = reconcileAfterPasswordReset,
): Promise<void> {
  const { token, password } = parse(passwordResetSchema, input);
  // Compte visé, lu AVANT la consommation du jeton (usage unique) pour la seconde réconciliation.
  const userId = await resetTokenUserId(auth, token);
  try {
    await auth.api.resetPassword({ body: { token, newPassword: password }, headers: ctx.headers });
  } catch (error) {
    if (!isAPIError(error)) throw error;
    await recordAudit(db, {
      actorId: null,
      action: "auth.password_reset",
      entityType: "PasswordReset",
      result: "FAILURE",
      ip: ctx.ip,
    });
    throw new AppError("VALIDATION", "Ce lien est invalide ou a expiré. Faites une nouvelle demande.");
  }
  if (!userId) return;
  // Second passage idempotent (le rappel onPasswordReset a pu échouer). Le mot de passe est déjà changé
  // et le jeton consommé : un échec ici est journalisé, jamais renvoyé à l'utilisateur.
  try {
    await reconcile(db, userId);
  } catch (error) {
    logger.error("Seconde réconciliation après réinitialisation échouée", { userId, error: errorName(error) });
  }
}

/** Page d'arrivée après un retour OAuth réussi (fusion du panier, puis redirection). */
export const SOCIAL_LANDING_PATH = "/connexion/sociale";
const SOCIAL_UNAVAILABLE = "Ce mode de connexion n'est pas disponible.";

const socialStartSchema = z.object({ provider: z.enum(SOCIAL_PROVIDER_IDS, SOCIAL_UNAVAILABLE), suivant: z.unknown().optional() });

/** URL d'arrivée (absolue, sur notre origine) portant la destination interne sûre, s'il y en a une. */
export function socialLandingURL(appUrl: string, next: unknown): string {
  const url = new URL(SOCIAL_LANDING_PATH, appUrl);
  const destination = safeRedirectPath(next, "");
  if (destination) url.searchParams.set("suivant", destination);
  return url.toString();
}

/**
 * Démarre une connexion sociale (clients uniquement) : fournisseur actif, plafond par IP, puis URL
 * d'autorisation du fournisseur (état OAuth et PKCE créés par Better Auth, cookie d'état posé).
 * Retourne l'URL vers laquelle rediriger, vérifiée chez le fournisseur attendu.
 */
export async function startSocialSignIn(
  auth: Auth,
  input: unknown,
  ctx: RequestContext,
  enabled: readonly SocialProviderId[],
): Promise<string> {
  const { provider, suivant } = parse(socialStartSchema, input);
  if (!enabled.includes(provider)) throw new AppError("VALIDATION", SOCIAL_UNAVAILABLE);
  if (await isSocialStartBlocked(db, ctx.ip)) throw new AppError("RATE_LIMITED", TOO_MANY_ATTEMPTS);
  await recordAudit(db, { actorId: null, action: SOCIAL_START_ACTION, entityType: "OAuthProvider", entityId: provider, ip: ctx.ip });

  const appUrl = getServerEnv().APP_URL;
  const landing = socialLandingURL(appUrl, suivant);
  const { url } = await auth.api.signInSocial({
    body: {
      provider,
      callbackURL: landing,
      newUserCallbackURL: landing,
      errorCallbackURL: `${appUrl}/connexion`,
      disableRedirect: true,
    },
    headers: ctx.headers,
  });
  if (!url || !isExpectedAuthorizationURL(provider, url)) {
    logger.error("URL d'autorisation inattendue", { provider });
    throw new AppError("INTERNAL", "La connexion n'a pas pu démarrer. Réessayez dans un instant.");
  }
  return url;
}
