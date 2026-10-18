import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createLocalStorage, isValidStorageKey, keyFromMediaUrl, mediaUrl, type FileStorage } from "./storage";

describe("stockage local", () => {
  let dir: string;
  let storage: FileStorage;

  beforeEach(async () => {
    dir = await mkdtemp(path.join(tmpdir(), "sama-storage-"));
    storage = createLocalStorage(dir);
  });
  afterEach(() => rm(dir, { recursive: true, force: true }));

  it("écrit, relit puis supprime un fichier", async () => {
    await storage.put("produits/p1/abc.png", Uint8Array.from([1, 2, 3]));
    expect([...((await storage.read("produits/p1/abc.png")) ?? [])]).toEqual([1, 2, 3]);
    await storage.remove("produits/p1/abc.png");
    expect(await storage.read("produits/p1/abc.png")).toBeNull();
  });

  it("n'écrase jamais un fichier existant", async () => {
    await storage.put("a.jpg", Uint8Array.from([1]));
    await expect(storage.put("a.jpg", Uint8Array.from([2]))).rejects.toThrow();
  });

  it("refuse toute clé hors du format attendu (remontée de dossier, extension, majuscules)", async () => {
    for (const key of ["../secret.png", "produits/../../x.png", "/etc/passwd", "a.svg", "A.png", "a/b/c/d/e.png", ""]) {
      expect(isValidStorageKey(key)).toBe(false);
      await expect(storage.read(key)).rejects.toMatchObject({ code: "VALIDATION" });
    }
  });

  it("convertit clé ↔ URL publique, et ignore les URL externes", () => {
    expect(mediaUrl("produits/p1/abc.webp")).toBe("/medias/produits/p1/abc.webp");
    expect(keyFromMediaUrl("/medias/produits/p1/abc.webp")).toBe("produits/p1/abc.webp");
    expect(keyFromMediaUrl("https://exemple.sn/a.png")).toBeNull();
    expect(keyFromMediaUrl("/medias/../x.png")).toBeNull();
  });
});
