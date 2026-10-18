import { describe, expect, it } from "vitest";
import { PERMISSIONS, type Permission } from "./permissions";
import { ROLE_CODES, ROLE_DEFINITIONS, SUPER_ADMIN, findRoleDefinition } from "./roles";

const rolesWith = (permission: Permission) =>
  ROLE_DEFINITIONS.filter((role) => role.permissions.includes(permission))
    .map((role) => role.code)
    .sort();

/**
 * Matrice attendue, écrite indépendamment de roles.ts : toute modification des droits
 * d'un rôle doit être reportée ici consciemment (§20 n° 3).
 */
const EXPECTED: Record<string, readonly Permission[] | "ALL"> = {
  SUPER_ADMIN: "ALL",
  ADMIN: "ALL",
  CATALOG_MANAGER: ["admin.access", "categories.manage", "inventory.read", "products.archive", "products.create", "products.read", "products.update"],
  STOCK_MANAGER: ["admin.access", "inventory.adjust", "inventory.read", "products.read", "reports.read"],
  ORDER_MANAGER: ["admin.access", "customers.read", "deliveries.manage", "inventory.read", "orders.read", "orders.update", "payments.read", "products.read", "returns.decide"],
  FINANCE_MANAGER: ["admin.access", "customers.read", "orders.read", "payments.correct", "payments.read", "payments.record", "reports.export", "reports.read"],
  DELIVERY_MANAGER: ["admin.access", "customers.read", "deliveries.manage", "orders.read", "payments.record"],
  TECH_MANAGER: ["admin.access", "customers.read", "interventions.manage", "interventions.read", "inventory.read", "payments.record", "products.read", "quotes.manage", "quotes.read"],
  TECHNICIAN: ["admin.access", "interventions.update_own"],
  CUSTOMER_SERVICE: ["admin.access", "customers.read", "interventions.read", "orders.read", "payments.read", "products.read", "quotes.read"],
};

describe("matrice des rôles (§14)", () => {
  it.each(Object.entries(EXPECTED))("le rôle %s a exactement les permissions attendues", (code, expected) => {
    const actual = [...(findRoleDefinition(code)?.permissions ?? [])].sort();
    expect(actual).toEqual(expected === "ALL" ? [...PERMISSIONS].sort() : [...expected].sort());
  });

  it("définit exactement 10 rôles aux codes uniques, avec des permissions connues", () => {
    expect(ROLE_DEFINITIONS).toHaveLength(10);
    expect(new Set(ROLE_CODES).size).toBe(10);
    for (const role of ROLE_DEFINITIONS) {
      expect(role.permissions.every((p) => PERMISSIONS.includes(p))).toBe(true);
      expect(new Set(role.permissions).size).toBe(role.permissions.length);
    }
  });

  it("donne toutes les permissions à l'administrateur principal", () => {
    expect([...(findRoleDefinition(SUPER_ADMIN)?.permissions ?? [])].sort()).toEqual([...PERMISSIONS].sort());
  });

  it("donne l'accès au back-office à tous les rôles du personnel", () => {
    expect(rolesWith("admin.access")).toEqual([...ROLE_CODES].sort());
  });

  it("réserve l'encaissement aux rôles habilités (§20 n° 16)", () => {
    expect(rolesWith("payments.record")).toEqual(
      ["ADMIN", "DELIVERY_MANAGER", "FINANCE_MANAGER", "SUPER_ADMIN", "TECH_MANAGER"].sort(),
    );
    expect(rolesWith("payments.correct")).toEqual(["ADMIN", "FINANCE_MANAGER", "SUPER_ADMIN"].sort());
  });

  it("réserve la décision sur un retour aux responsables (décision 2), le remboursement aux finances", () => {
    expect(rolesWith("returns.decide")).toEqual(["ADMIN", "ORDER_MANAGER", "SUPER_ADMIN"]);
  });

  it("réserve la gestion des rôles, des utilisateurs, des paramètres et l'audit aux administrateurs", () => {
    for (const permission of ["roles.manage", "users.manage", "settings.manage", "audit.read"] as const) {
      expect(rolesWith(permission)).toEqual(["ADMIN", "SUPER_ADMIN"]);
    }
  });

  it("limite le technicien à ses propres interventions", () => {
    expect([...(findRoleDefinition("TECHNICIAN")?.permissions ?? [])].sort()).toEqual(
      ["admin.access", "interventions.update_own"].sort(),
    );
  });
});
