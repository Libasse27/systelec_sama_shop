import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { OrderDetails } from "@/components/orders/order-details";
import { CustomerReturns } from "@/components/returns/customer-returns";
import { getCurrentUser } from "@/server/auth/session";
import { db } from "@/server/db/client";
import { getCustomerOrder, getGuestOrder } from "@/server/modules/orders/queries";
import { getCustomerReturns } from "@/server/modules/returns/customer";

export const metadata: Metadata = { title: "Suivi de commande", robots: { index: false }, referrer: "no-referrer" };

type Props = { params: Promise<{ number: string }>; searchParams: Promise<Record<string, string | string[] | undefined>> };

/** Confirmation et suivi : commande du compte connecté, ou commande invitée avec le jeton du lien. */
export default async function OrderTrackingPage({ params, searchParams }: Props) {
  const { number } = await params;
  const token = (await searchParams).jeton;
  const user = await getCurrentUser();
  const accountOrder = user ? await getCustomerOrder(db, user.id, number) : null;
  const order = accountOrder ?? (typeof token === "string" ? await getGuestOrder(db, number, token) : null);
  if (!order) notFound();
  // Commande invitée : reçus et facture s'ouvrent avec le même jeton que le lien de suivi.
  const receiptQuery = !accountOrder && typeof token === "string" ? `?jeton=${encodeURIComponent(token)}` : "";
  // Retours : par le compte (commande du compte) ou par le jeton du lien (commande invitée).
  const guestToken = !accountOrder && typeof token === "string" ? token : null;
  const returns = await getCustomerReturns(db, user && accountOrder ? { userId: user.id } : { userId: null, token: guestToken ?? undefined }, number);

  return (
    <main className="mx-auto max-w-3xl px-4 py-8">
      <h1 className="text-2xl font-bold">Commande {order.number}</h1>
      {order.status === "PENDING_CONFIRMATION" && (
        <p role="status" className="mt-4 rounded-lg border border-green-200 bg-green-50 p-3 text-green-900">
          Merci ! Votre commande est enregistrée et les articles vous sont réservés. Nous vous appelons au {order.contact.phone} pour la
          confirmer.
        </p>
      )}
      {!user && (
        <p className="mt-3 text-sm text-ink-muted">
          Conservez l&apos;adresse de cette page (favori) : c&apos;est votre lien de suivi personnel.
        </p>
      )}
      <div className="mt-6">
        <OrderDetails
          order={order}
          receiptHref={(receipt) => `/recus/${receipt}${receiptQuery}`}
          invoiceHref={(invoice) => `/factures/${invoice}${receiptQuery}`}
        />
      </div>
      {returns && <CustomerReturns orderNumber={order.number} token={guestToken} {...returns} />}
      <p className="mt-6 text-sm">
        <Link href={user ? "/compte" : "/"} className="text-brand-blue underline">
          {user ? "Mes commandes" : "Retour à la boutique"}
        </Link>
      </p>
    </main>
  );
}
