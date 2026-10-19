import { z } from "zod";

const DEV_APP_URL = "http://localhost:3000";

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
