const CONTROL_CHARACTERS = /[\u0000-\u001f\u007f]/;
const BASE = "http://interne.invalid";

/**
 * Chemin de redirection interne sûr (après connexion). Refuse les URL absolues,
 * protocol-relative (`//hôte`), les antislashs et les caractères de contrôle (un `/\t/hôte`
 * devient `//hôte` une fois tabulations et retours supprimés par le parseur d'URL),
 * puis vérifie que la résolution reste sur la même origine.
 */
export function safeRedirectPath(value: unknown, fallback: string): string {
  if (typeof value !== "string" || value.length === 0 || value.length > 500) return fallback;
  if (!value.startsWith("/") || value.startsWith("//") || value.includes("\\")) return fallback;
  if (CONTROL_CHARACTERS.test(value)) return fallback;
  try {
    const resolved = new URL(value, BASE);
    if (resolved.origin !== BASE || resolved.pathname.startsWith("//")) return fallback;
  } catch {
    return fallback;
  }
  return value;
}
