import { randomBytes } from "node:crypto";
import { linkSync, readFileSync, renameSync, unlinkSync, writeFileSync } from "node:fs";

/**
 * Verrou du répertoire de build des E2E (.next-e2e) : une seule exécution par dossier de travail.
 *
 * - Création atomique : le contenu complet est écrit dans un fichier temporaire du même dossier, puis lié
 *   au nom du verrou (`link` échoue si le verrou existe). Un verrou n'est donc jamais vu vide ou partiel,
 *   même en cas d'arrêt brutal.
 * - Vivant : le processus du lanceur OU le processus Playwright enregistré ensuite (`recordLockChild`) existe.
 *   Un lanceur tué seul (kill -9) laisse Playwright et son build en cours : le verrou reste alors détenu.
 * - Reprise d'un verrou orphelin : sous un verrou de reprise (créé atomiquement de la même façon), le
 *   fichier est relu et n'est supprimé que s'il est toujours CE verrou orphelin ; deux reprises ne peuvent
 *   pas avoir lieu en même temps, et le verrou tout juste pris par une autre exécution n'est jamais supprimé.
 * - Opérations synchrones : les signaux gérés par le lanceur (SIGINT, SIGTERM) ne les interrompent pas.
 * - Toute incertitude (verrou illisible, reprise déjà en cours ou interrompue, erreur de fichier) est un
 *   échec explicite, sans rien supprimer.
 */

export interface LockOwner {
  pid: number;
  runId: string;
  /** Processus Playwright de l'exécution, une fois lancé. */
  childPid?: number;
}

const errorCode = (error: unknown): string | undefined => (error as NodeJS.ErrnoException).code;

const isAlive = (pid: number): boolean => {
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    return errorCode(error) === "EPERM";
  }
};

export const ownerIsAlive = (owner: LockOwner): boolean => isAlive(owner.pid) || (owner.childPid !== undefined && isAlive(owner.childPid));

const readText = (file: string): string | undefined => {
  try {
    return readFileSync(file, "utf8");
  } catch (error) {
    if (errorCode(error) === "ENOENT") return undefined;
    throw new Error(`E2E : lecture du verrou ${file} impossible (${errorCode(error) ?? "erreur"}) ; rien n'a été supprimé.`);
  }
};

const isPid = (value: unknown): value is number => Number.isInteger(value) && (value as number) > 0;

const parseOwner = (text: string | undefined): LockOwner | undefined => {
  try {
    const owner = JSON.parse(text ?? "") as Partial<LockOwner>;
    if (!isPid(owner.pid) || typeof owner.runId !== "string" || (owner.childPid !== undefined && !isPid(owner.childPid))) return undefined;
    return { pid: owner.pid, runId: owner.runId, ...(owner.childPid !== undefined && { childPid: owner.childPid }) };
  } catch {
    return undefined;
  }
};

const temporaryName = (file: string): string => `${file}.${process.pid}.${randomBytes(6).toString("hex")}.tmp`;

const removeQuietly = (file: string): void => {
  try {
    unlinkSync(file);
  } catch (error) {
    if (errorCode(error) !== "ENOENT") console.warn(`E2E : fichier temporaire ${file} non supprimé (${errorCode(error) ?? "erreur"}).`);
  }
};

/** Crée `file` avec son contenu complet, de façon atomique et exclusive ; false s'il existe déjà. */
function createExclusive(file: string, content: string): boolean {
  const temporary = temporaryName(file);
  writeFileSync(temporary, content, { flag: "wx" });
  try {
    linkSync(temporary, file);
    return true;
  } catch (error) {
    if (errorCode(error) === "EEXIST") return false;
    throw new Error(`E2E : création du verrou ${file} impossible (${errorCode(error) ?? "erreur"}).`);
  } finally {
    removeQuietly(temporary);
  }
}

/**
 * Reprend le verrou orphelin dont le contenu exact a été lu (`orphanText`). Sous le verrou de reprise, le
 * fichier est relu : s'il a changé (une autre exécution l'a déjà repris), il n'est pas touché et la reprise échoue.
 */
export function takeOverOrphanLock(lockPath: string, orphanText: string, owner: LockOwner): void {
  const guard = `${lockPath}.reprise`;
  if (!createExclusive(guard, JSON.stringify(owner))) {
    const holder = parseOwner(readText(guard));
    const state = holder && !ownerIsAlive(holder) ? `interrompue (processus ${holder.pid} terminé)` : "en cours";
    throw new Error(`E2E : reprise du verrou ${lockPath} ${state} (fichier ${guard}) ; si aucune exécution E2E ne tourne, supprimez ce fichier.`);
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
    // Un échec ici ne masque pas l'erreur de reprise : il est signalé, et le fichier restant bloque les reprises suivantes.
    try {
      unlinkSync(guard);
    } catch (error) {
      console.error(`E2E : verrou de reprise ${guard} non supprimé (${errorCode(error) ?? "erreur"}) ; supprimez-le après vérification.`);
    }
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
  if (ownerIsAlive(current)) {
    const holder = isAlive(current.pid) ? `processus ${current.pid}` : `lanceur ${current.pid} terminé, Playwright ${current.childPid} toujours actif`;
    throw new Error(`E2E : une autre exécution (${holder}) détient le verrou ${lockPath} ; attendez sa fin.`);
  }
  console.warn(`E2E : verrou orphelin de l'exécution ${current.runId} (processus ${current.pid} terminé), reprise.`);
  takeOverOrphanLock(lockPath, text, owner);
}

/** Enregistre le processus Playwright dans le verrou de CETTE exécution (remplacement atomique par renommage). */
export function recordLockChild(lockPath: string, runId: string, childPid: number): void {
  const current = parseOwner(readText(lockPath));
  if (current?.runId !== runId || current.pid !== process.pid) throw new Error(`E2E : le verrou ${lockPath} n'appartient plus à cette exécution.`);
  const temporary = temporaryName(lockPath);
  writeFileSync(temporary, JSON.stringify({ ...current, childPid } satisfies LockOwner), { flag: "wx" });
  try {
    renameSync(temporary, lockPath);
  } catch (error) {
    removeQuietly(temporary);
    throw error;
  }
}

/** Libère le verrou seulement s'il appartient à cette exécution. */
export function releaseBuildLock(lockPath: string, runId: string): void {
  if (parseOwner(readText(lockPath))?.runId === runId) unlinkSync(lockPath);
}
