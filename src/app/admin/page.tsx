import type { Metadata } from "next";
import Link from "next/link";
import { PageHeader, Section } from "@/components/admin/admin-ui";
import { DELIVERY_STATUS_LABELS, INTERVENTION_STATUS_LABELS, ORDER_STATUS_LABELS, PRODUCT_STATUS_LABELS, QUOTE_REQUEST_STATUS_LABELS } from "@/lib/labels";
import { formatFcfa } from "@/lib/money";
import { findRoleDefinition } from "@/server/authz/roles";
import { requirePermission } from "@/server/auth/session";
import { db } from "@/server/db/client";
import { getDashboard } from "@/server/modules/reports/dashboard";

export const metadata: Metadata = { title: "Administration", robots: { index: false } };

const linkClass = "text-brand-blue underline-offset-2 hover:underline";

/** Liste « libellé → nombre » ; chaque libellé mène à la liste filtrée. */
function CountList<K extends string>({ labels, counts, href }: { labels: Partial<Record<K, string>>; counts: Partial<Record<K, number>>; href: (key: K) => string }) {
  const keys = Object.keys(labels) as K[];
  return (
    <ul className="space-y-1">
      {keys.map((key) => (
        <li key={key} className="flex justify-between gap-2">
          <Link href={href(key)} className={linkClass}>
            {labels[key]}
          </Link>
          <strong>{counts[key] ?? 0}</strong>
        </li>
      ))}
    </ul>
  );
}

function Amount({ label, value, strong = false }: { label: string; value: number; strong?: boolean }) {
  return (
    <div className="flex justify-between gap-2">
      <dt className="text-ink-muted">{label}</dt>
      <dd className={strong ? "font-semibold" : undefined}>{formatFcfa(value)}</dd>
    </div>
  );
}

const OPEN_ORDER_LABELS = {
  PENDING_CONFIRMATION: ORDER_STATUS_LABELS.PENDING_CONFIRMATION,
  CONFIRMED: ORDER_STATUS_LABELS.CONFIRMED,
  PREPARING: ORDER_STATUS_LABELS.PREPARING,
  READY_FOR_PICKUP: ORDER_STATUS_LABELS.READY_FOR_PICKUP,
  READY_TO_SHIP: ORDER_STATUS_LABELS.READY_TO_SHIP,
};

export default async function AdminHomePage() {
  // Garde dans la page (et non seulement dans un layout, qui n'est pas réévalué à chaque navigation).
  const user = await requirePermission("admin.access", "/admin");
  const roleLabels = user.roles.map((code) => findRoleDefinition(code)?.label ?? code);
  const dashboard = await getDashboard(db, user);
  const { orders, sales, cashToday, lowStock, quoteRequests, interventions, deliveries, catalog } = dashboard;

  return (
    <div className="flex flex-col gap-6">
      <PageHeader title="Tableau de bord" />
      <p className="-mt-4 text-ink-muted">
        Bonjour {user.name}. Rôle{roleLabels.length > 1 ? "s" : ""} : {roleLabels.join(", ")}.
      </p>

      <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
        {sales && (
          <Section title="Ventes remises au client">
            <dl className="space-y-1 text-sm">
              <Amount label={`Aujourd'hui (${sales.today.count})`} value={sales.today.total} strong />
              <Amount label={`Ce mois-ci (${sales.month.count})`} value={sales.month.total} />
            </dl>
            {user.permissions.has("payments.read") && (
              <Link href="/admin/rapports" className={`mt-3 inline-block text-sm ${linkClass}`}>
                Rapports financiers
              </Link>
            )}
          </Section>
        )}
        {cashToday && (
          <Section title="Caisse du jour">
            <dl className="space-y-1 text-sm">
              <Amount label="Encaissé" value={cashToday.received} />
              <Amount label="Annulé" value={cashToday.voided} />
              <Amount label="Remboursé" value={cashToday.refunded} />
              <Amount label="Net" value={cashToday.net} strong />
            </dl>
            <Link href="/admin/encaissements" className={`mt-3 inline-block text-sm ${linkClass}`}>
              Journal de caisse
            </Link>
          </Section>
        )}
        {orders && (
          <Section title="Commandes en cours">
            <CountList labels={OPEN_ORDER_LABELS} counts={orders.byStatus} href={(status) => `/admin/commandes?statut=${status}`} />
            <p className="mt-3 flex justify-between text-sm">
              <Link href="/admin/retours" className={linkClass}>
                Retours à traiter
              </Link>
              <strong>{orders.returnsToProcess}</strong>
            </p>
          </Section>
        )}
        {deliveries && (
          <Section title="Livraisons à faire">
            <CountList
              labels={{ ASSIGNED: DELIVERY_STATUS_LABELS.ASSIGNED, IN_TRANSIT: DELIVERY_STATUS_LABELS.IN_TRANSIT, FAILED: DELIVERY_STATUS_LABELS.FAILED }}
              counts={deliveries}
              href={(status) => `/admin/livraisons?statut=${status}`}
            />
          </Section>
        )}
        {quoteRequests && (
          <Section title="Demandes de devis">
            <CountList
              labels={{ NEW: QUOTE_REQUEST_STATUS_LABELS.NEW, IN_REVIEW: QUOTE_REQUEST_STATUS_LABELS.IN_REVIEW, QUOTED: QUOTE_REQUEST_STATUS_LABELS.QUOTED }}
              counts={quoteRequests}
              href={(status) => `/admin/demandes?statut=${status}`}
            />
          </Section>
        )}
        {interventions && (
          <Section title="Interventions en cours">
            <CountList
              labels={{ TO_SCHEDULE: INTERVENTION_STATUS_LABELS.TO_SCHEDULE, SCHEDULED: INTERVENTION_STATUS_LABELS.SCHEDULED, IN_PROGRESS: INTERVENTION_STATUS_LABELS.IN_PROGRESS }}
              counts={interventions}
              href={(status) => `/admin/interventions?statut=${status}`}
            />
          </Section>
        )}
        {lowStock && (
          <Section title="Alertes de stock">
            {lowStock.total === 0 ? (
              <p className="text-ink-muted">Aucune version sous son seuil d&apos;alerte.</p>
            ) : (
              <>
                <ul className="space-y-1 text-sm">
                  {lowStock.rows.map((row) => (
                    <li key={row.variantId} className="flex justify-between gap-2">
                      <Link href={`/admin/stock/${row.variantId}`} className={`truncate ${linkClass}`}>
                        {row.productName} — {row.variantName}
                      </Link>
                      <span className="font-semibold text-red-700">{row.available}</span>
                    </li>
                  ))}
                </ul>
                <Link href="/admin/stock?alertes=1" className={`mt-3 inline-block text-sm ${linkClass}`}>
                  Voir les {lowStock.total} alerte(s)
                </Link>
              </>
            )}
          </Section>
        )}
        {catalog && (
          <Section title="Catalogue">
            <CountList labels={PRODUCT_STATUS_LABELS} counts={catalog} href={(status) => `/admin/produits?statut=${status}`} />
          </Section>
        )}
        {user.permissions.has("interventions.update_own") && !interventions && (
          <Section title="Mes interventions">
            <Link href="/admin/interventions" className={linkClass}>
              Voir mes interventions et mon planning
            </Link>
          </Section>
        )}
      </div>
    </div>
  );
}
