/** Clés dont la valeur ne doit jamais apparaître dans le journal d'audit. */
const SENSITIVE_KEY_PATTERN = /pass(word)?|secret|token|hash|otp|cookie|session|card|iban|cvv/i;

export const REDACTED = "[MASQUÉ]";

/** Copie profonde d'une valeur avec masquage des champs sensibles (sans muter l'original). */
export function redact(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(redact);
  if (value instanceof Date) return value.toISOString();
  if (value !== null && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value).map(([key, entry]) => [key, SENSITIVE_KEY_PATTERN.test(key) ? REDACTED : redact(entry)]),
    );
  }
  return value;
}
