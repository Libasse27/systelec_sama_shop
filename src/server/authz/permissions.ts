/**
 * Liste de référence des permissions. Elle fait foi : la table `permissions` est
 * synchronisée depuis cette liste (voir sync.ts). Ajouter ici avant d'utiliser.
 */
export const PERMISSIONS = [
  "admin.access",
  "products.read",
  "products.create",
  "products.update",
  "products.archive",
  "categories.manage",
  "inventory.read",
  "inventory.adjust",
  "orders.read",
  "orders.update",
  "deliveries.manage",
  "payments.read",
  "payments.record",
  "payments.correct",
  "customers.read",
  "quotes.read",
  "quotes.manage",
  "interventions.read",
  "interventions.manage",
  "interventions.update_own",
  "content.manage",
  "users.manage",
  "roles.manage",
  "settings.manage",
  "reports.read",
  "reports.export",
  "audit.read",
] as const;

export type Permission = (typeof PERMISSIONS)[number];

export function isPermission(value: string): value is Permission {
  return (PERMISSIONS as readonly string[]).includes(value);
}
