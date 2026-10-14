import type { Metadata } from "next";
import Link from "next/link";
import { PageHeader, Section } from "@/components/admin/admin-ui";
import { PRODUCT_STATUS_LABELS } from "@/lib/labels";
import { findRoleDefinition } from "@/server/authz/roles";
import { requirePermission } from "@/server/auth/session";
import { db } from "@/server/db/client";
import { listInventory } from "@/server/modules/inventory/queries";

export const metadata: Metadata = { title: "Administration", robots: { index: false } };

async function productCounts() {
  const groups = await db.product.groupBy({ by: ["status"], _count: { _all: true } });
  return Object.fromEntries(groups.map((group) => [group.status, group._count._all]));
}

export default async function AdminHomePage() {
  // Garde dans la page (et non seulement dans un layout, qui n'est pas réévalué à chaque navigation).
  const user = await requirePermission("admin.access", "/admin");
  const roleLabels = user.roles.map((code) => findRoleDefinition(code)?.label ?? code);
  const counts = user.permissions.has("products.read") ? await productCounts() : null;
  const alerts = user.permissions.has("inventory.read") ? await listInventory(db, user, { alertsOnly: true }) : null;

  return (
    <div className="flex flex-col gap-6">
      <PageHeader title="Tableau de bord" />
      <p className="-mt-4 text-ink-muted">
        Bonjour {user.name}. Rôle{roleLabels.length > 1 ? "s" : ""} : {roleLabels.join(", ")}.
      </p>

      <div className="grid gap-4 md:grid-cols-2">
        {counts && (
          <Section title="Catalogue">
            <ul className="space-y-1">
              {Object.entries(PRODUCT_STATUS_LABELS).map(([status, label]) => (
                <li key={status} className="flex justify-between">
                  <Link href={`/admin/produits?statut=${status}`} className="text-brand-blue underline-offset-2 hover:underline">
                    {label}
                  </Link>
                  <strong>{counts[status] ?? 0}</strong>
                </li>
              ))}
            </ul>
          </Section>
        )}
        {alerts && (
          <Section title="Alertes de stock">
            {alerts.total === 0 ? (
              <p className="text-ink-muted">Aucune version sous son seuil d&apos;alerte.</p>
            ) : (
              <>
                <ul className="space-y-1 text-sm">
                  {alerts.rows.slice(0, 5).map((row) => (
                    <li key={row.variantId} className="flex justify-between gap-2">
                      <Link href={`/admin/stock/${row.variantId}`} className="truncate text-brand-blue underline-offset-2 hover:underline">
                        {row.productName} — {row.variantName}
                      </Link>
                      <span className="font-semibold text-red-700">{row.available}</span>
                    </li>
                  ))}
                </ul>
                <Link href="/admin/stock?alertes=1" className="mt-3 inline-block text-sm text-brand-blue underline">
                  Voir les {alerts.total} alerte(s)
                </Link>
              </>
            )}
          </Section>
        )}
      </div>
      <p className="text-sm text-ink-muted">Commandes, encaissements et services techniques arrivent dans les phases suivantes.</p>
    </div>
  );
}
