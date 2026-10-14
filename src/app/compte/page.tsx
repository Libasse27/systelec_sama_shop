import type { Metadata } from "next";
import Link from "next/link";
import { formatDate } from "@/lib/dates";
import { ORDER_STATUS_LABELS } from "@/lib/labels";
import { formatFcfa } from "@/lib/money";
import { requireUser } from "@/server/auth/session";
import { db } from "@/server/db/client";
import { listCustomerOrders } from "@/server/modules/orders/queries";

export const metadata: Metadata = { title: "Mon compte", robots: { index: false } };

export default async function AccountPage() {
  const user = await requireUser("/compte");
  const orders = await listCustomerOrders(db, user.id);
  return (
    <main className="mx-auto max-w-3xl px-4 py-10">
      <h1 className="text-2xl font-bold">Mon compte</h1>
      <dl className="mt-6 grid gap-3 rounded-xl border border-line bg-surface p-5 sm:grid-cols-[10rem_1fr]">
        <dt className="text-sm text-ink-muted">Nom</dt>
        <dd className="font-medium">{user.name}</dd>
        <dt className="text-sm text-ink-muted">E-mail</dt>
        <dd className="font-medium">{user.email}</dd>
      </dl>

      <section aria-labelledby="mes-commandes" className="mt-8">
        <h2 id="mes-commandes" className="text-lg font-semibold">
          Mes commandes
        </h2>
        {orders.length === 0 ? (
          <p className="mt-3 text-ink-muted">
            Aucune commande pour le moment.{" "}
            <Link href="/recherche" className="text-brand-blue underline">
              Parcourir le catalogue
            </Link>
          </p>
        ) : (
          <ul className="mt-3 divide-y divide-line rounded-xl border border-line bg-surface">
            {orders.map((order) => (
              <li key={order.number} className="flex flex-wrap items-center justify-between gap-2 p-4">
                <div>
                  <Link href={`/compte/commandes/${order.number}`} className="font-semibold text-brand-blue underline-offset-2 hover:underline">
                    {order.number}
                  </Link>
                  <p className="text-sm text-ink-muted">
                    {formatDate(order.createdAt)} · {order.itemCount} article(s)
                  </p>
                </div>
                <div className="text-right">
                  <p className="font-semibold">{formatFcfa(order.total)}</p>
                  <p className="text-sm">{ORDER_STATUS_LABELS[order.status]}</p>
                </div>
              </li>
            ))}
          </ul>
        )}
      </section>
    </main>
  );
}
