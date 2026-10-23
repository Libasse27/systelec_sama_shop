/**
 * Nettoyage des ressources d'une exécution E2E : chaque étape est tentée (ordre inverse de création), même si
 * une précédente échoue ; chaque échec est journalisé. Une erreur de nettoyage ne masque jamais l'erreur
 * d'origine : celle-ci reste la première des erreurs d'une AggregateError, dont le message la reprend.
 */

export type CleanupStep = { label: string; run: () => void | Promise<void> };

const describe = (error: unknown): string => (error instanceof Error ? error.message : String(error));

async function runSteps(steps: readonly CleanupStep[]): Promise<unknown[]> {
  const errors: unknown[] = [];
  for (const step of [...steps].reverse()) {
    try {
      await step.run();
    } catch (error) {
      console.error(`E2E : échec du nettoyage (${step.label}) : ${describe(error)}`);
      errors.push(error);
    }
  }
  return errors;
}

/**
 * Exécute `body`, qui déclare ses ressources avec `defer` au fur et à mesure de leur création, puis nettoie.
 * - succès et nettoyage complet : résultat de `body` ;
 * - échec de `body` seul : son erreur, inchangée ;
 * - échec du nettoyage : AggregateError (erreur d'origine en premier s'il y en a une).
 */
export async function runWithCleanup<T>(body: (defer: (step: CleanupStep) => void) => Promise<T>): Promise<T> {
  const steps: CleanupStep[] = [];
  let outcome: { ok: true; value: T } | { ok: false; error: unknown };
  try {
    outcome = { ok: true, value: await body((step) => steps.push(step)) };
  } catch (error) {
    outcome = { ok: false, error };
  }
  const cleanupErrors = await runSteps(steps);
  if (!outcome.ok) {
    if (cleanupErrors.length === 0) throw outcome.error;
    throw new AggregateError([outcome.error, ...cleanupErrors], `${describe(outcome.error)} (et ${cleanupErrors.length} échec(s) de nettoyage)`);
  }
  if (cleanupErrors.length > 0) throw new AggregateError(cleanupErrors, `E2E : nettoyage incomplet (${cleanupErrors.length} échec(s))`);
  return outcome.value;
}

/** Lignes à afficher pour un échec du lanceur : message principal, puis chaque erreur agrégée. */
export function failureLines(error: unknown): string[] {
  if (!(error instanceof AggregateError)) return [describe(error)];
  return [error.message, ...error.errors.map((inner, index) => `  ${index + 1}. ${describe(inner)}`)];
}
