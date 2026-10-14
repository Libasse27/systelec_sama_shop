import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { ActionForm, SubmitButton } from "@/components/forms/form-controls";
import { OrderDetails } from "@/components/orders/order-details";
import { requireUser } from "@/server/auth/session";
import { db } from "@/server/db/client";
import { getCustomerOrder } from "@/server/modules/orders/queries";
import { cancelOwnOrderAction } from "../../actions";

export const metadata: Metadata = { title: "Ma commande", robots: { index: false } };

type Props = { params: Promise<{ number: string }>; searchParams: Promise<Record<string, string | string[] | undefined>> };

export default async function AccountOrderPage({ params, searchParams }: Props) {
  const { number } = await params;
  const justCancelled = (await searchParams).annulee === "1";
  const user = await requireUser(`/compte/commandes/${number}`);
  const order = await getCustomerOrder(db, user.id, number);
  if (!order) notFound();

  return (
    <main className="mx-auto max-w-3xl px-4 py-8">
      <p className="text-sm">
        <Link href="/compte" className="text-brand-blue underline">
          ← Mes commandes
        </Link>
      </p>
      <h1 className="mt-2 text-2xl font-bold">Commande {order.number}</h1>
      {justCancelled && order.status === "CANCELLED" && (
        <p role="status" className="mt-4 rounded-lg border border-green-200 bg-green-50 p-3 text-green-900">
          Commande annulée. Les articles ont été remis en vente.
        </p>
      )}
      <div className="mt-6">
        <OrderDetails order={order} />
      </div>
      {order.status === "PENDING_CONFIRMATION" && (
        <ActionForm action={cancelOwnOrderAction.bind(null, order.number)} className="mt-6">
          <div>
            <SubmitButton variant="danger" confirm="Annuler cette commande ?">
              Annuler ma commande
            </SubmitButton>
          </div>
        </ActionForm>
      )}
    </main>
  );
}
