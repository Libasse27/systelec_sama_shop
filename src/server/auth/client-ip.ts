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

/**
 * Réseau d'une adresse pour les journaux techniques (IPv4 /24, IPv6 /48) : assez précis pour repérer
 * une source d'abus, sans conserver l'adresse d'une personne. Valeur invalide ou absente → undefined.
 */
export function ipNetwork(ip: string | undefined): string | undefined {
  if (!ip) return undefined;
  const version = isIP(ip);
  if (version === 4) return `${ip.split(".").slice(0, 3).join(".")}.0/24`;
  if (version !== 6) return undefined;
  const mapped = /^::ffff:(\d+\.\d+\.\d+\.\d+)$/i.exec(ip);
  if (mapped) return ipNetwork(mapped[1]);
  const [head = "", tail = ""] = ip.split("::");
  const left = head ? head.split(":") : [];
  const right = ip.includes("::") && tail ? tail.split(":") : [];
  const groups = ip.includes("::") ? [...left, ...Array<string>(8 - left.length - right.length).fill("0"), ...right] : left;
  return `${groups
    .slice(0, 3)
    .map((group) => Number.parseInt(group, 16).toString(16))
    .join(":")}::/48`;
}
