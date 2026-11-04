import { describe, expect, it } from "vitest";
import { isAdminPath } from "./routes";

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
