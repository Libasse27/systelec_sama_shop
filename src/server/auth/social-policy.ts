import "server-only";
import type { BetterAuthOptions } from "better-auth";
import type { UserKind } from "@/generated/prisma/client";
import { recordAudit } from "@/server/audit/audit";
import type { Db } from "@/server/db/client";
import { clientIp } from "./client-ip";
import { CREDENTIAL_PROVIDER } from "./social-accounts";
import { isSocialProviderId } from "./social-providers";

/**
 * Politique de la connexion sociale : réservée aux CLIENTS. Le personnel (kind STAFF ou au moins un rôle)
 * ne peut ni se connecter, ni relier un compte, ni être créé par un fournisseur ; il garde l'e-mail et le
 * mot de passe. Minimisation : aucun jeton OAuth ni avatar conservé. Journal : jamais de jeton, de code,
 * d'état, de profil brut ni d'e-mail complet.
 */

/** Même borne que le nom saisi à l'inscription (schemas.ts). */
export const SOCIAL_NAME_MAX = 120;
const DEFAULT_NAME = "Client";

/** Valeurs posées à la place des jetons OAuth : rien n'est conservé. */
export const CLEARED_TOKENS = {
  accessToken: null,
  refreshToken: null,
  idToken: null,
  accessTokenExpiresAt: null,
  refreshTokenExpiresAt: null,
} as const;
const TOKEN_FIELDS = Object.keys(CLEARED_TOKENS);

/** Codes de refus renvoyés au navigateur (voir social-errors.ts). */
export type SocialRefusal = "social_not_allowed" | "unable_to_create_session" | "account_not_linked";

export interface SocialHolder {
  kind: UserKind;
  isActive: boolean;
  roleCount: number;
}

export function isStaffHolder(holder: SocialHolder): boolean {
  return holder.kind !== "CUSTOMER" || holder.roleCount > 0;
}

/** Refus pour un compte existant : personnel d'abord (message neutre), puis compte désactivé. */
export function socialRefusal(holder: SocialHolder): SocialRefusal | null {
  if (isStaffHolder(holder)) return "social_not_allowed";
  if (!holder.isActive) return "unable_to_create_session";
  return null;
}

/**
 * Requête Better Auth issue d'un fournisseur : retour OAuth (« /callback/google » via le routeur,
 * « /callback/:id » via l'API) ou connexion par jeton d'identité (désactivée, refusée quand même).
 */
export function isOAuthPath(path: unknown): boolean {
  return typeof path === "string" && (path.startsWith("/callback/") || path === "/sign-in/social");
}

/** Nom du compte créé : celui du fournisseur, sinon la partie locale de l'e-mail (Apple peut n'en donner aucun). */
export function socialDisplayName(name: unknown, email: unknown): string {
  const provided = typeof name === "string" ? name.trim() : "";
  const localPart = typeof email === "string" ? (email.split("@")[0] ?? "").trim() : "";
  return (provided || localPart || DEFAULT_NAME).slice(0, SOCIAL_NAME_MAX);
}

export function hasTokenFields(data: object): boolean {
  return TOKEN_FIELDS.some((field) => field in data);
}

type DatabaseHooks = NonNullable<BetterAuthOptions["databaseHooks"]>;
type ValidateUserInfo = NonNullable<NonNullable<BetterAuthOptions["user"]>["validateUserInfo"]>;
type HookContext = Parameters<NonNullable<NonNullable<NonNullable<DatabaseHooks["session"]>["create"]>["before"]>>[1];

export interface SocialPolicyOptions {
  client: Db;
  trustedProxyHops: number;
}

async function loadHolder(db: Db, userId: unknown): Promise<SocialHolder | null> {
  if (typeof userId !== "string" || userId.length === 0) return null;
  const user = await db.user.findUnique({
    where: { id: userId },
    select: { kind: true, isActive: true, _count: { select: { roles: true } } },
  });
  return user ? { kind: user.kind, isActive: user.isActive, roleCount: user._count.roles } : null;
}

function providerOf(context: HookContext, fallback?: unknown): string {
  const candidate = (context?.params as { id?: unknown } | undefined)?.id ?? (context?.body as { provider?: unknown } | undefined)?.provider ?? fallback;
  return isSocialProviderId(candidate) ? candidate : "inconnu";
}

/** Fabrique les rappels Better Auth de la politique (validation, hooks de base de données, audit). */
export function createSocialPolicy({ client: db, trustedProxyHops }: SocialPolicyOptions) {
  const ipOf = (context: HookContext): string | undefined => {
    const headers = context?.request?.headers ?? context?.headers;
    return headers instanceof Headers ? clientIp(headers, trustedProxyHops) : undefined;
  };

  const audit = (context: HookContext, action: string, userId: string, after: Record<string, unknown>, denied = false) =>
    recordAudit(db, {
      actorId: denied ? null : userId,
      action,
      entityType: "User",
      entityId: userId,
      after,
      result: denied ? "DENIED" : "SUCCESS",
      ip: ipOf(context),
    });

  /** Refus journalisé (sans donnée personnelle hormis l'identifiant interne du compte). */
  const block = (context: HookContext, userId: string, provider: string, reason: SocialRefusal) =>
    audit(context, "auth.social.blocked", userId, { provider, reason }, true);

  const validateUserInfo: ValidateUserInfo = async ({ user, source }, context) => {
    if (source.method !== "oauth" || source.action === "create-user") return;
    const provider = providerOf(context, source.oauth?.providerId);
    const userId = String(user.id ?? "");
    const holder = await loadHolder(db, userId);
    const reason = holder ? socialRefusal(holder) : "unable_to_create_session";
    // Facebook n'atteste pas l'adresse e-mail : jamais de liaison automatique, quelle que soit sa réponse.
    const refusal = reason ?? (source.action === "link-account" && provider === "facebook" ? "account_not_linked" : null);
    if (!refusal) return;
    if (holder) await block(context, userId, provider, refusal);
    return { error: refusal, errorDescription: "refus" };
  };

  const userCreateBefore: NonNullable<NonNullable<DatabaseHooks["user"]>["create"]>["before"] = async (user, context) => {
    if (!isOAuthPath(context?.path)) return;
    // Création par un fournisseur : toujours un client actif, sans avatar.
    return { data: { ...user, kind: "CUSTOMER", isActive: true, image: null, name: socialDisplayName(user.name, user.email) } };
  };

  const userCreateAfter: NonNullable<NonNullable<DatabaseHooks["user"]>["create"]>["after"] = async (user, context) => {
    if (!isOAuthPath(context?.path)) return;
    await audit(context, "auth.social.signup", user.id, { provider: providerOf(context) });
  };

  const accountCreateBefore: NonNullable<NonNullable<DatabaseHooks["account"]>["create"]>["before"] = async (account, context) => {
    if (account.providerId === CREDENTIAL_PROVIDER) return;
    // Compte introuvable hors transaction = client créé dans ce même retour OAuth (forcé CUSTOMER plus haut).
    const holder = await loadHolder(db, account.userId);
    if (holder && isStaffHolder(holder)) {
      await block(context, account.userId, account.providerId, "social_not_allowed");
      return false;
    }
    return { data: { ...account, ...CLEARED_TOKENS } };
  };

  const accountCreateAfter: NonNullable<NonNullable<DatabaseHooks["account"]>["create"]>["after"] = async (account, context) => {
    if (account.providerId === CREDENTIAL_PROVIDER) return;
    // Un seul compte : création du client (déjà journalisée) ; sinon, liaison à un compte existant.
    if ((await db.account.count({ where: { userId: account.userId } })) <= 1) return;
    await audit(context, "auth.social.link", account.userId, { provider: account.providerId });
  };

  const accountUpdateBefore: NonNullable<NonNullable<DatabaseHooks["account"]>["update"]>["before"] = async (account) => {
    if (!hasTokenFields(account)) return;
    return { data: { ...account, ...CLEARED_TOKENS } };
  };

  const sessionCreateBefore: NonNullable<NonNullable<DatabaseHooks["session"]>["create"]>["before"] = async (session, context) => {
    const holder = await loadHolder(db, session.userId);
    // Un compte désactivé ne peut ouvrir aucune session.
    if (!holder?.isActive) return false;
    if (!isOAuthPath(context?.path) || !isStaffHolder(holder)) return;
    await block(context, session.userId, providerOf(context), "social_not_allowed");
    return false;
  };

  const sessionCreateAfter: NonNullable<NonNullable<DatabaseHooks["session"]>["create"]>["after"] = async (session, context) => {
    if (!isOAuthPath(context?.path)) return;
    await audit(context, "auth.social.login", session.userId, { provider: providerOf(context) });
  };

  return {
    validateUserInfo,
    databaseHooks: {
      user: { create: { before: userCreateBefore, after: userCreateAfter } },
      account: { create: { before: accountCreateBefore, after: accountCreateAfter }, update: { before: accountUpdateBefore } },
      session: { create: { before: sessionCreateBefore, after: sessionCreateAfter } },
    } satisfies DatabaseHooks,
  };
}
