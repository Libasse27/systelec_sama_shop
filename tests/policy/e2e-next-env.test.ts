import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { restoreNextEnv, snapshotNextEnv } from "../../e2e/support/next-env";

const DEV = '/// <reference types="next" />\nimport "./.next/dev/types/routes.d.ts";\n';
const E2E = '/// <reference types="next" />\nimport "./.next-e2e/types/routes.d.ts";\n';

describe("lanceur E2E : next-env.d.ts rétabli sans écraser une modification d'autrui", () => {
  let dir: string;
  let file: string;

  beforeEach(() => {
    dir = mkdtempSync(path.join(os.tmpdir(), "systelec-next-env-test-"));
    file = path.join(dir, "next-env.d.ts");
  });
  afterEach(() => rmSync(dir, { recursive: true, force: true }));

  it("rétablit le contenu initial après un build E2E", () => {
    writeFileSync(file, DEV);
    const snapshot = snapshotNextEnv(file);
    writeFileSync(file, E2E);
    expect(restoreNextEnv(file, snapshot, ".next-e2e")).toBe("rétabli");
    expect(readFileSync(file, "utf8")).toBe(DEV);
  });

  it("conserve une modification préexistante (le contenu initial, même édité à la main, est rétabli à l'identique)", () => {
    const edited = `${DEV}// ajout local\n`;
    writeFileSync(file, edited);
    const snapshot = snapshotNextEnv(file);
    writeFileSync(file, E2E);
    restoreNextEnv(file, snapshot, ".next-e2e");
    expect(readFileSync(file, "utf8")).toBe(edited);
  });

  it("supprime le fichier s'il n'existait pas avant et a été créé par le build E2E", () => {
    const snapshot = snapshotNextEnv(file);
    writeFileSync(file, E2E);
    expect(restoreNextEnv(file, snapshot, ".next-e2e")).toBe("supprimé");
    expect(existsSync(file)).toBe(false);
  });

  it("ne touche à rien si le fichier n'a pas changé (échec avant le build, interruption)", () => {
    writeFileSync(file, DEV);
    const snapshot = snapshotNextEnv(file);
    expect(restoreNextEnv(file, snapshot, ".next-e2e")).toBe("inchangé");
    expect(readFileSync(file, "utf8")).toBe(DEV);
  });

  it("n'écrase jamais un contenu écrit entre-temps par un autre outil (next dev relancé, édition)", () => {
    writeFileSync(file, DEV);
    const snapshot = snapshotNextEnv(file);
    const other = '/// <reference types="next" />\nimport "./.next/types/routes.d.ts";\n';
    writeFileSync(file, other);
    expect(restoreNextEnv(file, snapshot, ".next-e2e")).toBe("conservé");
    expect(readFileSync(file, "utf8")).toBe(other);
  });

  it("ne recrée pas un fichier supprimé entre-temps", () => {
    writeFileSync(file, DEV);
    const snapshot = snapshotNextEnv(file);
    rmSync(file);
    expect(restoreNextEnv(file, snapshot, ".next-e2e")).toBe("conservé");
    expect(existsSync(file)).toBe(false);
  });
});
