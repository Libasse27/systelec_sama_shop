import "server-only";
import { randomBytes } from "node:crypto";
import { cookies } from "next/headers";
import { getServerEnv } from "@/lib/env";
import { getCurrentUser } from "@/server/auth/session";
import { db } from "@/server/db/client";
import { logger } from "@/server/logger";
import { CART_TTL_DAYS, hashCartToken, mergeGuestCart, type CartOwner } from "./service";

/** En production (https), le préfixe __Host- interdit qu'un sous-domaine impose son propre jeton. */
const cartCookieName = () => (getServerEnv().APP_ENV === "production" ? "__Host-sama_panier" : "sama_panier");
const TOKEN_PATTERN = /^[A-Za-z0-9_-]{43}$/;

async function readToken(): Promise<string | null> {
  const token = (await cookies()).get(cartCookieName())?.value;
  return token && TOKEN_PATTERN.test(token) ? token : null;
}

/** Panier de la requête : celui du compte connecté, sinon celui du cookie visiteur (ou aucun). */
export async function readCartOwner(): Promise<CartOwner | null> {
  const user = await getCurrentUser();
  if (user) return { userId: user.id };
  const token = await readToken();
  return token ? { tokenHash: hashCartToken(token) } : null;
}

/**
 * Panier à utiliser pour écrire (actions serveur uniquement) : crée au besoin le jeton visiteur,
 * gardé dans un cookie httpOnly ; seule son empreinte est stockée en base.
 */
export async function ensureCartOwner(): Promise<CartOwner> {
  const owner = await readCartOwner();
  if (owner) return owner;
  const token = randomBytes(32).toString("base64url");
  (await cookies()).set(cartCookieName(), token, {
    httpOnly: true,
    sameSite: "lax",
    secure: getServerEnv().APP_ENV === "production",
    path: "/",
    maxAge: CART_TTL_DAYS * 24 * 3600,
  });
  return { tokenHash: hashCartToken(token) };
}

/** Après connexion ou inscription : le panier visiteur rejoint celui du compte. Ne bloque jamais la connexion. */
export async function mergeCartAfterSignIn(userId: string): Promise<void> {
  const token = await readToken();
  if (!token) return;
  try {
    await mergeGuestCart(db, hashCartToken(token), userId);
    (await cookies()).delete(cartCookieName());
  } catch (error) {
    logger.error("Fusion du panier visiteur impossible", { error: error instanceof Error ? error.message : "inconnue" });
  }
}
