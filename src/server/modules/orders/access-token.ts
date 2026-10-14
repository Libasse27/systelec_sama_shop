import "server-only";
import { createHmac, timingSafeEqual } from "node:crypto";
import { getServerEnv } from "@/lib/env";

/** Documents suivis par un invité au moyen d'un lien personnel. */
export type AccessScope = "order" | "quote_request" | "quote";

/**
 * Jeton du lien de suivi d'un document (client invité). Dérivé de l'identifiant par HMAC :
 * rien à stocker, et une double soumission retrouve le même lien. Non devinable sans AUTH_SECRET.
 * Le préfixe de portée empêche d'utiliser le jeton d'une commande pour un devis, et inversement.
 */
export function accessToken(scope: AccessScope, id: string): string {
  return createHmac("sha256", getServerEnv().AUTH_SECRET).update(`${scope}-access:${id}`).digest("base64url");
}

export function verifyAccessToken(scope: AccessScope, id: string, token: string | undefined): boolean {
  if (!token) return false;
  const expected = Buffer.from(accessToken(scope, id));
  const received = Buffer.from(token);
  return expected.length === received.length && timingSafeEqual(expected, received);
}

export const orderAccessToken = (orderId: string): string => accessToken("order", orderId);

export const verifyOrderAccessToken = (orderId: string, token: string | undefined): boolean => verifyAccessToken("order", orderId, token);
