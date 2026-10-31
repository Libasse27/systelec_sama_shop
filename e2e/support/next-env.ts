import { readFileSync, unlinkSync, writeFileSync } from "node:fs";

/**
 * `next build` réécrit next-env.d.ts (non versionné) pour pointer vers les types de son répertoire de build :
 * après un build dans .next-e2e, il référencerait .next-e2e. Le lanceur relève son état AVANT et le rétablit
 * APRÈS, mais seulement si le fichier est exactement celui écrit pour .next-e2e : une modification faite
 * entre-temps (next dev relancé, édition manuelle) est conservée, jamais écrasée.
 */

export type NextEnvSnapshot = { content: string | null };

export type NextEnvRestore = "inchangé" | "rétabli" | "supprimé" | "conservé";

const readOrNull = (file: string): string | null => {
  try {
    return readFileSync(file, "utf8");
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return null;
    throw error;
  }
};

export const snapshotNextEnv = (file: string): NextEnvSnapshot => ({ content: readOrNull(file) });

export function restoreNextEnv(file: string, snapshot: NextEnvSnapshot, distDir: string): NextEnvRestore {
  const current = readOrNull(file);
  if (current === snapshot.content) return "inchangé";
  if (current === null || !current.includes(`./${distDir}/`)) return "conservé";
  if (snapshot.content === null) {
    unlinkSync(file);
    return "supprimé";
  }
  writeFileSync(file, snapshot.content);
  return "rétabli";
}
