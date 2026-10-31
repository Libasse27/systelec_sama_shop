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
const EXPECTED: Record<string, readonly Permission[] | "ALL" | "ALL_BUT_SELF_REFUND"> = {
  SUPER_ADMIN: "ALL",
  // Décision 1 (phase 10) : l'exception « décider puis rembourser soi-même » est réservée à l'administrateur principal.
  ADMIN: "ALL_BUT_SELF_REFUND",
  CATALOG_MANAGER: ["admin.access", "categories.manage", "inventory.read", "products.archive", "products.create", "products.read", "products.update"],
  STOCK_MANAGER: ["admin.access", "inventory.adjust", "inventory.read", "products.read", "reports.read"],
  ORDER_MANAGER: ["admin.access", "customers.read", "deliveries.manage", "inventory.read", "orders.read", "orders.update", "payments.read", "products.read", "returns.decide"],
  FINANCE_MANAGER: ["admin.access", "customers.read", "orders.read", "payments.correct", "payments.read", "payments.record", "reports.export", "reports.read"],
  DELIVERY_MANAGER: ["admin.access", "customers.read", "deliveries.manage", "orders.read", "payments.record"],
  TECH_MANAGER: ["admin.access", "customers.read", "interventions.manage", "interventions.read", "inventory.read", "payments.record", "products.read", "quotes.manage", "quotes.read"],
  TECHNICIAN: ["admin.access", "interventions.update_own"],
  CUSTOMER_SERVICE: ["admin.access", "customers.read", "interventions.read", "messages.manage", "orders.read", "payments.read", "products.read", "quotes.read"],
  // Décision 5 (phase 10) : ses livraisons seulement (encaissement compris), rien d'autre.
  COURIER: ["admin.access", "deliveries.update_own"],
};

const expectedPermissions = (expected: (typeof EXPECTED)[string]): Permission[] => {
  if (expected === "ALL") return [...PERMISSIONS].sort();
  if (expected === "ALL_BUT_SELF_REFUND") return PERMISSIONS.filter((permission) => permission !== "returns.refund_own_decision").sort();
  return [...expected].sort();
};

describe("matrice des rôles (§14)", () => {
  it.each(Object.entries(EXPECTED))("le rôle %s a exactement les permissions attendues", (code, expected) => {
    const actual = [...(findRoleDefinition(code)?.permissions ?? [])].sort();
    expect(actual).toEqual(expectedPermissions(expected));
  });

  it("définit exactement 11 rôles aux codes uniques, avec des permissions connues", () => {
    expect(ROLE_DEFINITIONS).toHaveLength(11);
    expect(new Set(ROLE_CODES).size).toBe(11);
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

  it("réserve l'exception de remboursement par le décideur à l'administrateur principal (décision 1)", () => {
    expect(rolesWith("returns.refund_own_decision")).toEqual([SUPER_ADMIN]);
  });

  it("limite le livreur à ses propres livraisons : ni remboursement, ni comptabilité, ni administration (décision 5)", () => {
    expect(rolesWith("deliveries.update_own")).toEqual(["ADMIN", "COURIER", "SUPER_ADMIN"]);
    const courier = findRoleDefinition("COURIER")?.permissions ?? [];
    for (const forbidden of ["payments.record", "payments.correct", "payments.read", "reports.read", "orders.read", "customers.read", "deliveries.manage"] as const) {
      expect(courier).not.toContain(forbidden);
    }
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
