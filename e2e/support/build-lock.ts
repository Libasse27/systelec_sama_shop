import { closeSync, openSync, readFileSync, unlinkSync, writeSync } from "node:fs";

/**
 * Verrou du répertoire de build des E2E (.next-e2e) : une seule exécution par dossier de travail.
 * Fichier créé de façon exclusive (« wx ») avec le processus et l'exécution propriétaires. Un verrou dont le
 * processus est terminé (orphelin) est repris, mais seulement sous un second verrou de reprise et après avoir
 * relu qu'il est toujours CE verrou orphelin : jamais le verrou tout juste pris par une autre exécution.
 * Toute incertitude (verrou illisible, reprise déjà en cours) est un échec explicite.
 */

export interface LockOwner {
  pid: number;
  runId: string;
}

const isAlive = (pid: number): boolean => {
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    return (error as NodeJS.ErrnoException).code === "EPERM";
  }
};

const readText = (file: string): string | undefined => {
  try {
    return readFileSync(file, "utf8");
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return undefined;
    throw error;
  }
};

const parseOwner = (text: string | undefined): LockOwner | undefined => {
  try {
    const owner = JSON.parse(text ?? "") as Partial<LockOwner>;
    return Number.isInteger(owner.pid) && typeof owner.runId === "string" ? (owner as LockOwner) : undefined;
  } catch {
    return undefined;
  }
};

/** Crée le fichier de façon exclusive ; false s'il existe déjà. */
function createExclusive(file: string, content: string): boolean {
  let fd: number;
  try {
    fd = openSync(file, "wx");
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "EEXIST") return false;
    throw error;
  }
  try {
    writeSync(fd, content);
  } finally {
    closeSync(fd);
  }
  return true;
}

/**
 * Reprend le verrou orphelin dont le contenu exact a été lu (`orphanText`). Sous le verrou de reprise, le
 * fichier est relu : s'il a changé (une autre exécution l'a déjà repris), il n'est pas touché et la reprise échoue.
 */
export function takeOverOrphanLock(lockPath: string, orphanText: string, owner: LockOwner): void {
  const guard = `${lockPath}.reprise`;
  if (!createExclusive(guard, JSON.stringify(owner))) {
    throw new Error(`E2E : reprise du verrou ${lockPath} déjà en cours (fichier ${guard}) ; si aucune exécution E2E ne tourne, supprimez-le.`);
  }
  try {
    if (readText(lockPath) !== orphanText) {
      throw new Error(`E2E : le verrou ${lockPath} a changé pendant sa reprise (autre exécution) ; relancez plus tard.`);
    }
    unlinkSync(lockPath);
    if (!createExclusive(lockPath, JSON.stringify(owner))) {
      throw new Error(`E2E : une autre exécution a pris le verrou ${lockPath} pendant sa reprise ; relancez plus tard.`);
    }
  } finally {
    unlinkSync(guard);
  }
}

/** Prend le verrou ; refus si une exécution vivante le détient ; un verrou orphelin est repris en sécurité. */
export function acquireBuildLock(lockPath: string, owner: LockOwner): void {
  if (createExclusive(lockPath, JSON.stringify(owner))) return;
  const text = readText(lockPath);
  if (text === undefined) {
    // Libéré entre-temps : une seule nouvelle tentative, sans boucle.
    if (createExclusive(lockPath, JSON.stringify(owner))) return;
    throw new Error(`E2E : verrou ${lockPath} pris par une autre exécution ; attendez sa fin.`);
  }
  const current = parseOwner(text);
  if (!current) throw new Error(`E2E : verrou ${lockPath} illisible ; vérifiez qu'aucune exécution E2E n'est en cours, puis supprimez-le.`);
  if (isAlive(current.pid)) throw new Error(`E2E : une autre exécution (processus ${current.pid}) détient le verrou ${lockPath} ; attendez sa fin.`);
  console.warn(`E2E : verrou orphelin de l'exécution ${current.runId} (processus ${current.pid} terminé), reprise.`);
  takeOverOrphanLock(lockPath, text, owner);
}

/** Libère le verrou seulement s'il appartient à cette exécution. */
export function releaseBuildLock(lockPath: string, runId: string): void {
  if (parseOwner(readText(lockPath))?.runId === runId) unlinkSync(lockPath);
}
