import "server-only";
import { createHmac, timingSafeEqual } from "node:crypto";
import { getServerEnv } from "@/lib/env";

/**
 * Jeton du lien de suivi d'une commande (client invité). Dérivé de l'identifiant par HMAC :
 * rien à stocker, et une double soumission retrouve le même lien. Non devinable sans AUTH_SECRET.
 */
export function orderAccessToken(orderId: string): string {
  return createHmac("sha256", getServerEnv().AUTH_SECRET).update(`order-access:${orderId}`).digest("base64url");
}

export function verifyOrderAccessToken(orderId: string, token: string | undefined): boolean {
  if (!token) return false;
  const expected = Buffer.from(orderAccessToken(orderId));
  const received = Buffer.from(token);
  return expected.length === received.length && timingSafeEqual(expected, received);
}
