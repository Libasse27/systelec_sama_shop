import "server-only";
import type { Db } from "@/server/db/client";

/** Fenêtre glissante commune aux limitations, calculées depuis le journal d'audit. */
export const WINDOW_MINUTES = 15;

export const LOGIN_LIMITS = {
  /** Échecs pour un couple (e-mail, IP) : bloque l'attaquant sans bloquer le titulaire ailleurs. */
  perEmailAndIp: 5,
  /** Échecs pour un e-mail toutes IP confondues (attaque distribuée sur un compte). */
  perEmail: 20,
  /** Échecs depuis une IP, tous e-mails confondus (pulvérisation de mots de passe). */
  perIp: 30,
  /** Sans IP fiable (développement, pas de proxy) : seul le compteur par e-mail s'applique. */
  perEmailWithoutIp: 5,
} as const;

export const SIGNUP_LIMIT_PER_IP = 10;
export const RESET_REQUEST_LIMITS = { perEmail: 3, perIp: 10 } as const;

const windowStart = () => new Date(Date.now() - WINDOW_MINUTES * 60_000);

/**
 * Vrai si de nouvelles tentatives de connexion doivent être refusées. Compte les tentatives
 * non réussies (échouées ou encore en cours) de la table login_attempts.
 */
export async function isLoginBlocked(client: Db, email: string, ip: string | undefined): Promise<boolean> {
  const since = windowStart();
  // Une connexion réussie remet à zéro le compteur lié à l'e-mail.
  const lastSuccess = await client.loginAttempt.findFirst({
    where: { email, status: "SUCCESS", createdAt: { gte: since } },
    orderBy: { createdAt: "desc" },
    select: { createdAt: true },
  });
  const emailSince = lastSuccess?.createdAt ?? since;
  const unsuccessful = (where: object) => client.loginAttempt.count({ where: { status: { not: "SUCCESS" }, ...where } });

  if (!ip) {
    return (await unsuccessful({ email, createdAt: { gt: emailSince } })) >= LOGIN_LIMITS.perEmailWithoutIp;
  }
  const [byEmailAndIp, byEmail, byIp] = await Promise.all([
    unsuccessful({ email, ip, createdAt: { gt: emailSince } }),
    unsuccessful({ email, createdAt: { gt: emailSince } }),
    unsuccessful({ ip, createdAt: { gte: since } }),
  ]);
  return byEmailAndIp >= LOGIN_LIMITS.perEmailAndIp || byEmail >= LOGIN_LIMITS.perEmail || byIp >= LOGIN_LIMITS.perIp;
}

/** Un seul refus journalisé par entité et par fenêtre, pour ne pas remplir le journal append-only. */
export async function shouldRecordDenial(client: Db, action: string, entityId: string): Promise<boolean> {
  const existing = await client.auditLog.findFirst({
    where: { action, entityId, result: "DENIED", createdAt: { gte: windowStart() } },
    select: { id: true },
  });
  return existing === null;
}

export async function isSignupBlocked(client: Db, ip: string | undefined): Promise<boolean> {
  if (!ip) return false;
  const attempts = await client.auditLog.count({
    where: { action: "auth.signup", ip, createdAt: { gte: windowStart() } },
  });
  return attempts >= SIGNUP_LIMIT_PER_IP;
}

export async function isResetRequestBlocked(client: Db, email: string, ip: string | undefined): Promise<boolean> {
  const since = windowStart();
  const action = "auth.password_reset.request";
  const [byEmail, byIp] = await Promise.all([
    client.auditLog.count({ where: { action, entityId: email, createdAt: { gte: since } } }),
    ip ? client.auditLog.count({ where: { action, ip, createdAt: { gte: since } } }) : Promise.resolve(0),
  ]);
  return byEmail >= RESET_REQUEST_LIMITS.perEmail || byIp >= RESET_REQUEST_LIMITS.perIp;
}
