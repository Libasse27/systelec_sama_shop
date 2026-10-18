import type { NextRequest } from "next/server";
import { getCurrentUser } from "@/server/auth/session";
import { db } from "@/server/db/client";
import { getReceipt } from "@/server/modules/payments/queries";
import { renderReceiptPdf } from "@/server/modules/payments/receipt-pdf";

export const dynamic = "force-dynamic";

const RECEIPT_NUMBER = /^REC-\d{4}-\d{6}$/;

const notFound = () => new Response("Reçu introuvable", { status: 404, headers: { "Cache-Control": "no-store" } });

/**
 * Reçu PDF d'un encaissement : personnel des encaissements, titulaire du compte, ou invité
 * avec le jeton de son lien de suivi (?jeton=). Tout autre cas répond 404.
 */
export async function GET(request: NextRequest, { params }: { params: Promise<{ number: string }> }) {
  const { number } = await params;
  if (!RECEIPT_NUMBER.test(number)) return notFound();
  const token = request.nextUrl.searchParams.get("jeton") ?? undefined;
  const receipt = await getReceipt(db, { user: await getCurrentUser(), token }, number);
  if (!receipt) return notFound();
  const pdf = await renderReceiptPdf(receipt);
  return new Response(new Uint8Array(pdf), {
    headers: {
      "Content-Type": "application/pdf",
      "Content-Disposition": `inline; filename="recu-${receipt.receiptNumber}.pdf"`,
      "Cache-Control": "private, no-store",
      // Le lien d'un invité porte son jeton : il ne doit fuiter ni par le référent ni par un moteur.
      "Referrer-Policy": "no-referrer",
      "X-Robots-Tag": "noindex",
    },
  });
}
