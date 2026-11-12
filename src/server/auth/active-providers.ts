import "server-only";
import { getServerEnv } from "@/lib/env";
import { logger } from "@/server/logger";
import { enabledSocialProviders, isAppleSecretExpired, type SocialProviderId } from "./social-providers";

let appleExpiryReported = false;

/**
 * Fournisseurs actifs pour la requête courante (pages, action, route de retour). Un secret Apple expiré
 * désactive Apple seul ; il est signalé une fois par processus, sans rien révéler du secret.
 */
export function activeSocialProviders(): readonly SocialProviderId[] {
  const env = getServerEnv();
  if (!appleExpiryReported && isAppleSecretExpired(env)) {
    appleExpiryReported = true;
    logger.error("Connexion Apple désactivée : APPLE_CLIENT_SECRET expiré, le régénérer (scripts/ops/apple-client-secret.ts)", {
      provider: "apple",
    });
  }
  return enabledSocialProviders(env);
}
