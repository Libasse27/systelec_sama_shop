import "server-only";
import { revalidatePath } from "next/cache";
import { requireUser, type CurrentUser } from "@/server/auth/session";
import { AppError, ValidationError } from "@/server/errors";
import { logger } from "@/server/logger";
import type { ActionState } from "./form-state";

/** Convertit une erreur en message affichable ; les erreurs inattendues sont journalisées, pas montrées. */
export function toActionState(error: unknown): ActionState {
  if (error instanceof ValidationError) {
    const details = error.details as { fieldErrors?: Record<string, string[]> } | undefined;
    return { error: details?.fieldErrors ? "Vérifiez les champs signalés." : error.message, fieldErrors: details?.fieldErrors };
  }
  if (error instanceof AppError) return { error: error.message };
  logger.error("Erreur inattendue dans une action d'administration", {
    error: error instanceof Error ? error.message : "inconnue",
  });
  return { error: "Une erreur est survenue. Réessayez dans un instant." };
}

/**
 * Exécute une action d'administration : session exigée (les permissions sont vérifiées par
 * le service appelé), erreurs converties en état de formulaire, pages /admin rafraîchies.
 */
export async function adminAction(
  returnTo: string,
  run: (actor: CurrentUser) => Promise<string | void>,
): Promise<ActionState> {
  const actor = await requireUser(returnTo);
  try {
    const success = await run(actor);
    revalidatePath("/admin", "layout");
    return { success: success ?? "Enregistré.", doneAt: Date.now() };
  } catch (error) {
    return toActionState(error);
  }
}
