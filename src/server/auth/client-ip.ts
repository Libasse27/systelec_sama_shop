import { isIP } from "node:net";

/**
 * Adresse IP du client, lue dans X-Forwarded-For au rang fixé par le nombre de proxys
 * de confiance : avec un reverse proxy qui AJOUTE l'IP vue (nginx `$proxy_add_x_forwarded_for`),
 * l'entrée fiable est la dernière (hops = 1). Les entrées plus à gauche sont fournies par le
 * client et donc falsifiables. Avec hops = 0 (aucun proxy), l'en-tête est ignoré.
 * Toute valeur qui n'est pas une IP valide est rejetée.
 */
export function clientIp(headers: Headers, trustedProxyHops: number): string | undefined {
  if (trustedProxyHops <= 0) return undefined;
  const chain = (headers.get("x-forwarded-for") ?? "")
    .split(",")
    .map((entry) => entry.trim())
    .filter(Boolean);
  const candidate = chain[chain.length - trustedProxyHops];
  return candidate && isIP(candidate) ? candidate : undefined;
}
