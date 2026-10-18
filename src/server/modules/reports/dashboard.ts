import "server-only";
import type { DeliveryStatus, InterventionStatus, OrderStatus, ProductStatus, QuoteRequestStatus } from "@/generated/prisma/client";
import { businessDateKey, businessDayRange } from "@/lib/dates";
import { assertPermission, type Actor } from "@/server/authz/service";
import type { Db } from "@/server/db/client";
import { PENDING_DELIVERY_WHERE } from "@/server/modules/deliveries/queries";
import { listInventory } from "@/server/modules/inventory/queries";

type Counts<K extends string> = Partial<Record<K, number>>;

export interface Dashboard {
  /** orders.read : commandes en cours par statut, retours à traiter. */
  orders: { byStatus: Counts<OrderStatus>; returnsToProcess: number } | null;
  /** orders.read + reports.read : ventes remises au client aujourd'hui et ce mois-ci. */
  sales: { today: { count: number; total: number }; month: { count: number; total: number } } | null;
  /** payments.read : caisse du jour. */
  cashToday: { received: number; voided: number; refunded: number; net: number } | null;
  /** inventory.read : versions sous leur seuil d'alerte. */
  lowStock: { total: number; rows: { variantId: string; productName: string; variantName: string; available: number }[] } | null;
  /** quotes.read : demandes à traiter. */
  quoteRequests: Counts<QuoteRequestStatus> | null;
  /** interventions.read ou interventions.manage : interventions en cours. */
  interventions: Counts<InterventionStatus> | null;
  /** deliveries.manage : livraisons à faire. */
  deliveries: Counts<DeliveryStatus> | null;
  /** products.read : catalogue par statut. */
  catalog: Counts<ProductStatus> | null;
}

const OPEN_ORDER_STATUSES: OrderStatus[] = ["PENDING_CONFIRMATION", "CONFIRMED", "PREPARING", "READY_FOR_PICKUP", "READY_TO_SHIP"];

const countsOf = <K extends string>(groups: { key: K; count: number }[]): Counts<K> => Object.fromEntries(groups.map((group) => [group.key, group.count])) as Counts<K>;

function monthRange(today: string): { from: Date; to: Date } {
  const day = businessDayRange(today)!;
  const first = businessDayRange(`${today.slice(0, 8)}01`)!;
  return { from: first.from, to: day.to };
}

async function salesBetween(client: Db, range: { from: Date; to: Date }) {
  const result = await client.order.aggregate({ where: { status: "CLOSED", closedAt: { gte: range.from, lt: range.to } }, _count: true, _sum: { total: true } });
  return { count: result._count, total: result._sum.total ?? 0 };
}

/**
 * Indicateurs du tableau de bord, chacun calculé seulement si le rôle y a droit (sinon null) :
 * aucune donnée n'est lue pour un indicateur non autorisé.
 */
export async function getDashboard(client: Db, actor: Actor, now: Date = new Date()): Promise<Dashboard> {
  await assertPermission(client, actor, "admin.access");
  const has = (permission: Parameters<Actor["permissions"]["has"]>[0]) => actor.permissions.has(permission);
  const today = businessDateKey(now);
  const todayRange = businessDayRange(today)!;

  const [orders, sales, cashToday, lowStock, quoteRequests, interventions, deliveries, catalog] = await Promise.all([
    has("orders.read")
      ? Promise.all([
          client.order.groupBy({ by: ["status"], where: { status: { in: OPEN_ORDER_STATUSES } }, _count: { _all: true } }),
          client.return.count({ where: { status: { in: ["RECEIVED", "VERIFICATION", "REFUND_PENDING"] } } }),
        ]).then(([groups, returnsToProcess]) => ({ byStatus: countsOf(groups.map((group) => ({ key: group.status, count: group._count._all }))), returnsToProcess }))
      : null,
    has("orders.read") && has("reports.read")
      ? Promise.all([salesBetween(client, todayRange), salesBetween(client, monthRange(today))]).then(([todaySales, month]) => ({ today: todaySales, month }))
      : null,
    has("payments.read")
      ? Promise.all([
          client.payment.aggregate({ where: { createdAt: { gte: todayRange.from, lt: todayRange.to }, amount: { gt: 0 } }, _sum: { amount: true } }),
          client.payment.aggregate({ where: { createdAt: { gte: todayRange.from, lt: todayRange.to }, amount: { lt: 0 }, returnId: null }, _sum: { amount: true } }),
          client.payment.aggregate({ where: { createdAt: { gte: todayRange.from, lt: todayRange.to }, returnId: { not: null } }, _sum: { amount: true } }),
        ]).then(([received, voided, refunded]) => {
          const totals = { received: received._sum.amount ?? 0, voided: 0 - (voided._sum.amount ?? 0), refunded: 0 - (refunded._sum.amount ?? 0) };
          return { ...totals, net: totals.received - totals.voided - totals.refunded };
        })
      : null,
    has("inventory.read")
      ? listInventory(client, actor, { alertsOnly: true }).then((alerts) => ({
          total: alerts.total,
          rows: alerts.rows.slice(0, 5).map(({ variantId, productName, variantName, available }) => ({ variantId, productName, variantName, available })),
        }))
      : null,
    has("quotes.read")
      ? client.quoteRequest
          .groupBy({ by: ["status"], where: { status: { in: ["NEW", "IN_REVIEW", "QUOTED"] } }, _count: { _all: true } })
          .then((groups) => countsOf(groups.map((group) => ({ key: group.status, count: group._count._all }))))
      : null,
    has("interventions.read") || has("interventions.manage")
      ? client.intervention
          .groupBy({ by: ["status"], where: { status: { in: ["TO_SCHEDULE", "SCHEDULED", "IN_PROGRESS"] } }, _count: { _all: true } })
          .then((groups) => countsOf(groups.map((group) => ({ key: group.status, count: group._count._all }))))
      : null,
    has("deliveries.manage")
      ? client.delivery
          .groupBy({ by: ["status"], where: PENDING_DELIVERY_WHERE, _count: { _all: true } })
          .then((groups) => countsOf(groups.map((group) => ({ key: group.status, count: group._count._all }))))
      : null,
    has("products.read")
      ? client.product.groupBy({ by: ["status"], _count: { _all: true } }).then((groups) => countsOf(groups.map((group) => ({ key: group.status, count: group._count._all }))))
      : null,
  ]);
  return { orders, sales, cashToday, lowStock, quoteRequests, interventions, deliveries, catalog };
}
