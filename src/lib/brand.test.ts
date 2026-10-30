import { describe, expect, it } from "vitest";
import { INFORMATION_PAGES } from "@/server/modules/catalog/taxonomy";
import { aboutPageBody, BRAND, FUTURE_DIVISIONS, GROUP_VALUES, SHOP_PILLARS_LINE } from "./brand";

describe("identité FUTANI", () => {
  it("distingue le groupe, la boutique et le pôle technique", () => {
    expect(BRAND.group.name).toBe("FUTANI GROUP");
    expect(BRAND.shop.name).toBe("FUTANI SHOP");
    expect(BRAND.tech.name).toBe("FUTANI TECH");
    expect(BRAND.group.signature).toBe("Deux héritages, une vision d'avenir.");
    expect(SHOP_PILLARS_LINE).toBe("Commerce · Technologie · Services");
  });

  it("présente les pôles DIGITAL, NETWORK, SECURITY et SERVICES comme à venir", () => {
    const body = aboutPageBody();
    const futureSection = body.slice(body.indexOf("Pôles à venir"));
    for (const { name } of FUTURE_DIVISIONS) {
      expect(futureSection).toContain(name);
      expect(body.indexOf(name)).toBeGreaterThan(body.indexOf("Pôles à venir"));
    }
  });

  it("rédige la page À propos en paragraphes séparés, avec mission, vision et valeurs", () => {
    const paragraphs = aboutPageBody().split(/\n\s*\n/);
    expect(paragraphs.length).toBeGreaterThan(5);
    expect(paragraphs.some((p) => p.startsWith("Notre mission\n"))).toBe(true);
    expect(paragraphs.some((p) => p.startsWith("Notre vision\n"))).toBe(true);
    expect(paragraphs.find((p) => p.startsWith("Nos valeurs\n"))).toContain(GROUP_VALUES.join(" · "));
  });

  it("n'invente aucune coordonnée ni identifiant légal", () => {
    expect(aboutPageBody()).not.toMatch(/\+221|@|NINEA|RCCM|https?:\/\//);
  });

  it("tire le titre de la page À propos de la source centrale", () => {
    expect(INFORMATION_PAGES.find((page) => page.slug === "a-propos")?.title).toBe(`À propos de ${BRAND.group.name}`);
  });
});
