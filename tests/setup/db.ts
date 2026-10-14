import { db } from "@/server/db/client";

/**
 * Vide les tables entre deux tests. TRUNCATE n'est pas bloqué par le trigger
 * append-only de audit_logs (qui vise UPDATE/DELETE) ; en production, le rôle
 * applicatif ne doit pas disposer du privilège TRUNCATE (voir docs).
 */
export async function resetDatabase(): Promise<void> {
  await db.$executeRawUnsafe(
    `TRUNCATE site_settings, sequences, audit_logs, users, sessions, accounts, verifications,
              user_roles, role_permissions, roles, permissions, login_attempts, stock_movements,
              categories, brands, products, product_images, product_variants, inventories,
              product_compatibilities, service_categories, services, pages, faq_items,
              carts, cart_items, delivery_zones, pickup_points, customers, orders, order_items,
              order_status_history, notifications RESTART IDENTITY CASCADE`,
  );
}
