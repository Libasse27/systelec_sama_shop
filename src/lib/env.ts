import { z } from "zod";
import { jwtExpiry } from "./jwt-expiry";

const DEV_APP_URL = "http://localhost:3000";

/** Chaîne vide (variable déclarée mais non remplie) = absence. */
const optionalText = z.preprocess((v) => (v === "" ? undefined : v), z.string().min(1).optional());

// Locataire Microsoft : comptes personnels (« consumers », défaut), « common » ou identifiant d'annuaire (GUID).
const MICROSOFT_TENANT = /^(consumers|common|[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})$/i;

/** Paires identifiant / secret des fournisseurs de connexion sociale (toutes facultatives). */
const SOCIAL_CREDENTIAL_PAIRS = [
  ["GOOGLE_CLIENT_ID", "GOOGLE_CLIENT_SECRET"],
  ["FACEBOOK_CLIENT_ID", "FACEBOOK_CLIENT_SECRET"],
  ["APPLE_CLIENT_ID", "APPLE_CLIENT_SECRET"],
  ["MICROSOFT_CLIENT_ID", "MICROSOFT_CLIENT_SECRET"],
] as const;

type SocialCredentials = Partial<Record<(typeof SOCIAL_CREDENTIAL_PAIRS)[number][number], string>>;

/** Identifiant et secret vont ensemble ; le secret Apple doit être un JWT avec une expiration. */
function checkSocialCredentials(env: SocialCredentials, ctx: z.RefinementCtx): void {
  for (const [idKey, secretKey] of SOCIAL_CREDENTIAL_PAIRS) {
    if (Boolean(env[idKey]) === Boolean(env[secretKey])) continue;
    const missing = env[idKey] ? secretKey : idKey;
    ctx.addIssue({ code: "custom", path: [missing], message: `${idKey} et ${secretKey} vont ensemble` });
  }
  // Secret Apple : JWT ES256 pré-généré (scripts/ops/apple-client-secret.ts). Mal formé ou sans expiration :
  // refus au démarrage. Expiré : seul Apple est désactivé (social-providers.ts), la boutique démarre.
  if (env.APPLE_CLIENT_SECRET !== undefined && jwtExpiry(env.APPLE_CLIENT_SECRET) === null) {
    ctx.addIssue({ code: "custom", path: ["APPLE_CLIENT_SECRET"], message: "APPLE_CLIENT_SECRET doit être un JWT avec une date d'expiration (exp)" });
  }
}

const serverEnvSchema = z
  .object({
    APP_ENV: z.enum(["development", "test", "production"]).default("development"),
    APP_URL: z.url().optional(),
    DATABASE_URL: z.url({ protocol: /^postgres(ql)?$/, error: "DATABASE_URL doit être une URL PostgreSQL" }),
    AUTH_SECRET: z.string().min(32, "AUTH_SECRET doit contenir au moins 32 caractères (openssl rand -base64 32)"),
    // Connexions PostgreSQL simultanées par processus (réserve de l'application, rôle restreint).
    DATABASE_POOL_MAX: z.coerce.number().int().min(1).max(100).default(10),
    STORAGE_DRIVER: z.enum(["local", "s3"]).default("local"),
    STORAGE_LOCAL_DIR: z.string().default("./storage"),
    // E-mail : désactivé tant que SMTP_HOST est vide (aucun envoi simulé).
    SMTP_HOST: z.string().optional().transform((v) => v || undefined),
    SMTP_PORT: z.preprocess((v) => (v === "" ? undefined : v), z.coerce.number().int().min(1).max(65535).optional()),
    // Nombre de reverse proxys de confiance devant l'application (lecture de X-Forwarded-For).
    TRUSTED_PROXY_HOPS: z.coerce.number().int().min(0).max(5).default(1),
    SMTP_USER: z.string().optional(),
    SMTP_PASSWORD: z.string().optional(),
    SMTP_FROM: z.string().optional(),
    // Connexion sociale (clients uniquement) : chaque fournisseur n'est actif que si sa paire est renseignée.
    GOOGLE_CLIENT_ID: optionalText,
    GOOGLE_CLIENT_SECRET: optionalText,
    FACEBOOK_CLIENT_ID: optionalText,
    FACEBOOK_CLIENT_SECRET: optionalText,
    APPLE_CLIENT_ID: optionalText,
    APPLE_CLIENT_SECRET: optionalText,
    MICROSOFT_CLIENT_ID: optionalText,
    MICROSOFT_CLIENT_SECRET: optionalText,
    MICROSOFT_TENANT_ID: z.preprocess(
      (v) => (v === "" ? undefined : v),
      z.string().regex(MICROSOFT_TENANT, "MICROSOFT_TENANT_ID : consumers, common ou identifiant d'annuaire (GUID)").default("consumers"),
    ),
  })
  .superRefine((env, ctx) => {
    // E-mail activé (SMTP_HOST) : configuration complète exigée au démarrage, pas au premier envoi.
    if (env.SMTP_HOST !== undefined) {
      if (env.SMTP_PORT === undefined) ctx.addIssue({ code: "custom", path: ["SMTP_PORT"], message: "SMTP_PORT requis avec SMTP_HOST (587 ou 465)" });
      if (!env.SMTP_FROM) ctx.addIssue({ code: "custom", path: ["SMTP_FROM"], message: "SMTP_FROM requis avec SMTP_HOST (expéditeur vérifié chez le fournisseur)" });
      if (Boolean(env.SMTP_USER) !== Boolean(env.SMTP_PASSWORD)) {
        ctx.addIssue({ code: "custom", path: ["SMTP_PASSWORD"], message: "SMTP_USER et SMTP_PASSWORD vont ensemble" });
      }
    }
    checkSocialCredentials(env, ctx);
    if (env.APP_ENV !== "production") return;
    const url = env.APP_URL;
    if (!url || !url.startsWith("https://") || url.endsWith("/")) {
      ctx.addIssue({
        code: "custom",
        path: ["APP_URL"],
        message: "APP_URL doit être définie en production, en https et sans slash final",
      });
    }
  })
  .transform((env) => ({ ...env, APP_URL: env.APP_URL ?? DEV_APP_URL }));

export type ServerEnv = z.infer<typeof serverEnvSchema>;

/** Valide une source de configuration ; échoue clairement si elle est invalide. */
export function parseServerEnv(source: Record<string, string | undefined>): ServerEnv {
  const parsed = serverEnvSchema.safeParse(source);
  if (!parsed.success) {
    throw new Error(`Configuration serveur invalide :\n${z.prettifyError(parsed.error)}`);
  }
  return parsed.data;
}

let cachedEnv: ServerEnv | undefined;

/** Lit et valide la configuration serveur une seule fois. */
export function getServerEnv(): ServerEnv {
  cachedEnv ??= parseServerEnv(process.env);
  return cachedEnv;
}
