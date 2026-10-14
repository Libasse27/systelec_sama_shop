import "server-only";
import type { ActionState } from "@/lib/form-state";
import { AppError, ValidationError } from "./errors";
import { logger } from "./logger";

/** Convertit une erreur en message affichable ; les erreurs inattendues sont journalisées, pas montrées. */
export function toActionState(error: unknown): ActionState {
  if (error instanceof ValidationError) {
    const details = error.details as { fieldErrors?: Record<string, string[]> } | undefined;
    return { error: details?.fieldErrors ? "Vérifiez les champs signalés." : error.message, fieldErrors: details?.fieldErrors };
  }
  if (error instanceof AppError) return { error: error.message };
  logger.error("Erreur inattendue dans une action serveur", {
    error: error instanceof Error ? error.message : "inconnue",
  });
  return { error: "Une erreur est survenue. Réessayez dans un instant." };
}
