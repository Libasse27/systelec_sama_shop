import "server-only";
import { revalidatePath } from "next/cache";
import { requireUser, type CurrentUser } from "@/server/auth/session";
import { toActionState } from "@/server/action-state";
import type { ActionState } from "@/lib/form-state";

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
