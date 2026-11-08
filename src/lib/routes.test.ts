import { describe, expect, it } from "vitest";
import { isAdminPath, isTechPath } from "./routes";

describe("isAdminPath", () => {
  it("reconnaît le back-office et ses sous-pages", () => {
    expect(isAdminPath("/admin")).toBe(true);
    expect(isAdminPath("/admin/")).toBe(true);
    expect(isAdminPath("/admin/annonces")).toBe(true);
    expect(isAdminPath("/admin/retours/abc/photos/1")).toBe(true);
  });

  it("ne confond pas les pages publiques dont le nom commence pareil", () => {
    expect(isAdminPath("/")).toBe(false);
    expect(isAdminPath("/administration")).toBe(false);
    expect(isAdminPath("/admin-x")).toBe(false);
    expect(isAdminPath("/produits/admin")).toBe(false);
  });
});

describe("isTechPath", () => {
  it("reconnaît la rubrique Services et les devis de FUTANI TECH", () => {
    expect(isTechPath("/services")).toBe(true);
    expect(isTechPath("/services/categorie/electricite")).toBe(true);
    expect(isTechPath("/services/installation-camera")).toBe(true);
    expect(isTechPath("/devis/demande")).toBe(true);
    expect(isTechPath("/devis/DEV-2026-0001")).toBe(true);
  });

  it("laisse la boutique et les pages dont le nom commence pareil à FUTANI SHOP", () => {
    expect(isTechPath("/")).toBe(false);
    expect(isTechPath("/categories/informatique")).toBe(false);
    expect(isTechPath("/panier")).toBe(false);
    expect(isTechPath("/contact")).toBe(false);
    expect(isTechPath("/services-x")).toBe(false);
    expect(isTechPath("/devisx")).toBe(false);
    expect(isTechPath("/produits/services")).toBe(false);
  });
});
