/**
 * Date d'expiration (`exp`, en secondes) d'un JWT, lue dans la charge utile SANS vérifier la signature :
 * sert seulement à contrôler un secret pré-généré (Apple). Null si le jeton est mal formé ou sans `exp`.
 */
export function jwtExpiry(token: string): number | null {
  const parts = token.split(".");
  if (parts.length !== 3 || !parts[1] || !/^[A-Za-z0-9_-]+$/.test(parts[1])) return null;
  try {
    const payload: unknown = JSON.parse(Buffer.from(parts[1], "base64url").toString("utf8"));
    const exp = (payload as { exp?: unknown } | null)?.exp;
    return typeof exp === "number" && Number.isFinite(exp) ? exp : null;
  } catch {
    return null;
  }
}

/** Vrai si le JWT porte une expiration encore à venir. */
export function isJwtUnexpired(token: string, nowMs: number): boolean {
  const exp = jwtExpiry(token);
  return exp !== null && exp * 1000 > nowMs;
}
