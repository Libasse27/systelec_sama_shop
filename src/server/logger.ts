import "server-only";

type Level = "info" | "warn" | "error";

/** Journal technique structuré (JSON sur stdout/stderr). Ne jamais y écrire de secret. */
function log(level: Level, message: string, context?: Record<string, unknown>): void {
  // Le contexte d'abord : il ne peut pas écraser le niveau, le message ni l'horodatage.
  const line = JSON.stringify({ ...context, level, message, at: new Date().toISOString() });
  if (level === "error") console.error(line);
  else if (level === "warn") console.warn(line);
  else console.info(line);
}

export const logger = {
  info: (message: string, context?: Record<string, unknown>) => log("info", message, context),
  warn: (message: string, context?: Record<string, unknown>) => log("warn", message, context),
  error: (message: string, context?: Record<string, unknown>) => log("error", message, context),
};
