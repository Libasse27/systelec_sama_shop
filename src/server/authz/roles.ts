import { PERMISSIONS, type Permission } from "./permissions";

export const SUPER_ADMIN = "SUPER_ADMIN";

export interface RoleDefinition {
  code: string;
  label: string;
  permissions: readonly Permission[];
}

/**
 * Les 10 rôles système (§14) et leur matrice de permissions.
 * L'administrateur principal et l'administrateur ont toutes les permissions ;
 * seul un administrateur principal peut attribuer ou retirer le rôle d'administrateur principal.
 */
export const ROLE_DEFINITIONS: readonly RoleDefinition[] = [
  { code: SUPER_ADMIN, label: "Administrateur principal", permissions: PERMISSIONS },
  { code: "ADMIN", label: "Administrateur", permissions: PERMISSIONS },
  {
    code: "CATALOG_MANAGER",
    label: "Gestionnaire de catalogue",
    permissions: [
      "admin.access",
      "products.read",
      "products.create",
      "products.update",
      "products.archive",
      "categories.manage",
      "inventory.read",
    ],
  },
  {
    code: "STOCK_MANAGER",
    label: "Gestionnaire de stock",
    permissions: ["admin.access", "products.read", "inventory.read", "inventory.adjust", "reports.read"],
  },
  {
    code: "ORDER_MANAGER",
    label: "Gestionnaire de commandes",
    permissions: [
      "admin.access",
      "products.read",
      "inventory.read",
      "orders.read",
      "orders.update",
      "deliveries.manage",
      "payments.read",
      "customers.read",
    ],
  },
  {
    code: "FINANCE_MANAGER",
    label: "Responsable financier",
    permissions: [
      "admin.access",
      "orders.read",
      "payments.read",
      "payments.record",
      "payments.correct",
      "customers.read",
      "reports.read",
      "reports.export",
    ],
  },
  {
    code: "DELIVERY_MANAGER",
    label: "Responsable de livraison",
    permissions: ["admin.access", "orders.read", "deliveries.manage", "payments.record", "customers.read"],
  },
  {
    code: "TECH_MANAGER",
    label: "Responsable technique",
    permissions: [
      "admin.access",
      "products.read",
      "inventory.read",
      "customers.read",
      "quotes.read",
      "quotes.manage",
      "interventions.read",
      "interventions.manage",
      "payments.record",
    ],
  },
  {
    code: "TECHNICIAN",
    label: "Technicien",
    permissions: ["admin.access", "interventions.update_own"],
  },
  {
    code: "CUSTOMER_SERVICE",
    label: "Service client",
    permissions: [
      "admin.access",
      "products.read",
      "orders.read",
      "payments.read",
      "customers.read",
      "quotes.read",
      "interventions.read",
    ],
  },
];

export const ROLE_CODES = ROLE_DEFINITIONS.map((role) => role.code);

export function findRoleDefinition(code: string): RoleDefinition | undefined {
  return ROLE_DEFINITIONS.find((role) => role.code === code);
}
