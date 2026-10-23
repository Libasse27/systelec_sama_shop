import { spawn, spawnSync, type ChildProcessWithoutNullStreams } from "node:child_process";
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { createInterface } from "node:readline";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { acquireBuildLock, releaseBuildLock, takeOverOrphanLock } from "../../e2e/support/build-lock";

const CONTENDER = path.resolve(__dirname, "../support/e2e-lock-contender.ts");
const CONTENDERS = 6;

/** Identifiant d'un processus terminé (orphelin). */
const deadPid = (): number => {
  const { pid } = spawnSync(process.execPath, ["-e", ""]);
  if (!pid) throw new Error("processus de test non lancé");
  return pid;
};

const lockOf = (file: string): unknown => JSON.parse(readFileSync(file, "utf8"));

describe("lanceur E2E : verrou du répertoire de build (.next-e2e)", () => {
  let dir: string;
  let lock: string;

  beforeEach(() => {
    dir = mkdtempSync(path.join(os.tmpdir(), "systelec-lock-test-"));
    lock = path.join(dir, ".next-e2e.lock");
    vi.spyOn(console, "warn").mockImplementation(() => undefined);
  });
  afterEach(() => {
    vi.restoreAllMocks();
    rmSync(dir, { recursive: true, force: true });
  });

  it("prend un verrou libre et ne libère que le sien", () => {
    acquireBuildLock(lock, { pid: process.pid, runId: "a" });
    expect(lockOf(lock)).toEqual({ pid: process.pid, runId: "a" });
    releaseBuildLock(lock, "b");
    expect(existsSync(lock)).toBe(true);
    releaseBuildLock(lock, "a");
    expect(existsSync(lock)).toBe(false);
  });

  it("refuse un verrou détenu par une exécution vivante, sans le modifier", () => {
    const held = JSON.stringify({ pid: process.pid, runId: "vivante" });
    writeFileSync(lock, held);
    expect(() => acquireBuildLock(lock, { pid: process.pid, runId: "nouvelle" })).toThrow(/détient le verrou/);
    expect(readFileSync(lock, "utf8")).toBe(held);
  });

  it("refuse un verrou illisible, sans le supprimer", () => {
    writeFileSync(lock, "pas du json");
    expect(() => acquireBuildLock(lock, { pid: process.pid, runId: "nouvelle" })).toThrow(/illisible/);
    expect(readFileSync(lock, "utf8")).toBe("pas du json");
  });

  it("reprend un verrou orphelin (processus terminé) et ne laisse pas de verrou de reprise", () => {
    writeFileSync(lock, JSON.stringify({ pid: deadPid(), runId: "orpheline" }));
    acquireBuildLock(lock, { pid: process.pid, runId: "nouvelle" });
    expect(lockOf(lock)).toEqual({ pid: process.pid, runId: "nouvelle" });
    expect(existsSync(`${lock}.reprise`)).toBe(false);
  });

  it("reprise : ne supprime jamais le verrou qu'une autre exécution a pris entre la lecture et la reprise", () => {
    const orphan = JSON.stringify({ pid: deadPid(), runId: "orpheline" });
    const newer = JSON.stringify({ pid: process.pid, runId: "concurrente" });
    writeFileSync(lock, newer);
    expect(() => takeOverOrphanLock(lock, orphan, { pid: process.pid, runId: "moi" })).toThrow(/a changé pendant sa reprise/);
    expect(readFileSync(lock, "utf8")).toBe(newer);
    expect(existsSync(`${lock}.reprise`)).toBe(false);
  });

  it("reprise : refus explicite si une autre reprise est en cours (verrou de reprise présent)", () => {
    const orphan = JSON.stringify({ pid: deadPid(), runId: "orpheline" });
    writeFileSync(lock, orphan);
    writeFileSync(`${lock}.reprise`, JSON.stringify({ pid: process.pid, runId: "autre" }));
    expect(() => acquireBuildLock(lock, { pid: process.pid, runId: "moi" })).toThrow(/reprise du verrou .* déjà en cours/);
    expect(readFileSync(lock, "utf8")).toBe(orphan);
    expect(existsSync(`${lock}.reprise`)).toBe(true);
  });

  it(`concurrence réelle : ${CONTENDERS} processus reprennent le même orphelin en même temps, un seul obtient le verrou`, async () => {
    writeFileSync(lock, JSON.stringify({ pid: deadPid(), runId: "orpheline" }));
    const children: ChildProcessWithoutNullStreams[] = [];
    try {
      const results = await new Promise<Array<{ runId: string; ok: boolean; error?: string }>>((resolve, reject) => {
        const collected: Array<{ runId: string; ok: boolean; error?: string }> = [];
        let ready = 0;
        for (let index = 0; index < CONTENDERS; index += 1) {
          const contender = spawn(process.execPath, ["--import", "tsx", CONTENDER, lock, `concurrent-${index}`]);
          children.push(contender);
          contender.once("error", reject);
          contender.stderr.on("data", () => undefined);
          createInterface({ input: contender.stdout }).on("line", (line) => {
            if (line === "prêt") {
              ready += 1;
              if (ready === CONTENDERS) for (const each of children) each.stdin.write("go\n");
              return;
            }
            collected.push(JSON.parse(line));
            if (collected.length === CONTENDERS) resolve(collected);
          });
        }
      });

      const winners = results.filter((result) => result.ok);
      expect(winners).toHaveLength(1);
      expect(lockOf(lock)).toMatchObject({ runId: winners[0]?.runId });
      for (const loser of results.filter((result) => !result.ok)) {
        expect(loser.error).toMatch(/détient le verrou|reprise du verrou|a changé pendant sa reprise|a pris le verrou|pris par une autre exécution/);
      }
      expect(existsSync(`${lock}.reprise`)).toBe(false);
    } finally {
      await Promise.all(children.map((each) => new Promise((resolve) => {
        each.once("exit", resolve);
        each.stdin.end();
      })));
    }
  }, 30_000);
});
