"use server";

import { db } from "@/server/db/client";
import { ValidationError } from "@/server/errors";
import { MAX_IMPORT_BYTES, type ImportPlan } from "@/server/modules/catalog/csv-import-plan";
import { applyCatalogImport, previewCatalogImport } from "@/server/modules/catalog/csv-transfer";
import { adminAction } from "../_lib/action";
import type { ActionState } from "@/lib/form-state";

export interface ImportState extends ActionState {
  plan?: ImportPlan;
}

const PREVIEW_LIMIT = 200;

async function readCsvFile(formData: FormData): Promise<string> {
  const file = formData.get("fichier");
  if (!(file instanceof File) || file.size === 0) {
    throw new ValidationError("Choisissez un fichier CSV.", { fieldErrors: { fichier: ["Fichier manquant"] } });
  }
  if (file.size > MAX_IMPORT_BYTES) throw new ValidationError("Fichier trop volumineux (2 Mo maximum).");
  return file.text();
}

/**
 * « Aperçu » analyse sans rien écrire. « Appliquer » refait l'analyse : s'il reste des erreurs,
 * elles sont affichées et rien n'est écrit ; sinon l'import est appliqué en tout ou rien.
 */
export async function importCatalogAction(_state: ImportState, formData: FormData): Promise<ImportState> {
  let plan: ImportPlan | undefined;
  const state = await adminAction("/admin/import-export", async (actor) => {
    const text = await readCsvFile(formData);
    plan = await previewCatalogImport(db, actor, text);
    if (plan.errors.length > 0) throw new ValidationError("Le fichier contient des erreurs : rien n'a été modifié.");
    if (formData.get("intent") !== "apply") {
      return plan.changes.length > 0 ? "Aperçu prêt : vérifiez les changements, puis appliquez." : "Aucun changement détecté.";
    }
    const { updated } = await applyCatalogImport(db, actor, text);
    plan = undefined;
    return `Import appliqué : ${updated} version(s) mise(s) à jour.`;
  });
  return { ...state, plan: plan && { ...plan, changes: plan.changes.slice(0, PREVIEW_LIMIT) } };
}
