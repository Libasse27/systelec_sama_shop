import { describe, expect, it } from "vitest";
import type { SettingValue } from "@/server/modules/settings/schemas";
import { selectVisible } from "./visibility";

type Item = SettingValue<"announcements">["items"][number];

const base: Item = { id: "5b1f3a52-9c1e-4d52-8d55-0d1c3a6f7a10", text: "Texte", href: null, kind: "ANNOUNCEMENT", isActive: true, startsAt: null, endsAt: null };
const value = (...items: Item[]): SettingValue<"announcements"> => ({ items, rotationSeconds: 6 });
const NOW = new Date("2026-11-10T12:00:00.000Z");

describe("selectVisible", () => {
  it("renvoie une liste vide quand il n'y a aucune annonce", () => {
    expect(selectVisible(value(), NOW)).toEqual([]);
  });

  it("ne garde que id, text, href et kind", () => {
    expect(selectVisible(value({ ...base, href: "/produits", kind: "PROMOTION" }), NOW)).toEqual([{ id: base.id, text: "Texte", href: "/produits", kind: "PROMOTION" }]);
  });

  it("écarte les annonces désactivées", () => {
    expect(selectVisible(value({ ...base, isActive: false }), NOW)).toEqual([]);
  });

  it("applique la fenêtre : début inclus, fin exclue, bornes nulles = illimité", () => {
    const at = (startsAt: string | null, endsAt: string | null) => selectVisible(value({ ...base, startsAt, endsAt }), NOW).length;
    expect(at("2026-11-10T12:00:00.000Z", null)).toBe(1);
    expect(at("2026-11-10T12:00:01.000Z", null)).toBe(0);
    expect(at(null, "2026-11-10T12:00:00.000Z")).toBe(0);
    expect(at(null, "2026-11-10T12:00:00.001Z")).toBe(1);
    expect(at("2026-11-01T00:00:00Z", "2026-11-30T00:00:00Z")).toBe(1);
    expect(at(null, null)).toBe(1);
  });

  it("exclut une date illisible sans planter", () => {
    expect(selectVisible(value({ ...base, startsAt: "pas-une-date" }), NOW)).toEqual([]);
    expect(selectVisible(value({ ...base, endsAt: "pas-une-date" }), NOW)).toEqual([]);
  });

  it("conserve l'ordre et ne modifie pas l'entrée", () => {
    const input = value({ ...base, id: "a" }, { ...base, id: "b", isActive: false }, { ...base, id: "c" });
    const snapshot = JSON.stringify(input);
    expect(selectVisible(input, NOW).map((item) => item.id)).toEqual(["a", "c"]);
    expect(JSON.stringify(input)).toBe(snapshot);
  });
});
