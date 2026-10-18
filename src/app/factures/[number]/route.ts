import type { NextRequest } from "next/server";
import { getCurrentUser } from "@/server/auth/session";
import { db } from "@/server/db/client";
import { renderInvoicePdf } from "@/server/modules/invoices/invoice-pdf";
import { getInvoice } from "@/server/modules/invoices/service";

export const dynamic = "force-dynamic";

const INVOICE_NUMBER = /^FAC-\d{4}-\d{6}$/;

const notFound = () => new Response("Facture introuvable", { status: 404, headers: { "Cache-Control": "no-store" } });

/** Facture PDF : personnel autorisé, titulaire du compte, ou invité avec le jeton de son devis. Sinon 404. */
export async function GET(request: NextRequest, { params }: { params: Promise<{ number: string }> }) {
  const { number } = await params;
  if (!INVOICE_NUMBER.test(number)) return notFound();
  const token = request.nextUrl.searchParams.get("jeton") ?? undefined;
  const invoice = await getInvoice(db, { user: await getCurrentUser(), token }, number);
  if (!invoice) return notFound();
  const pdf = await renderInvoicePdf(invoice);
  return new Response(new Uint8Array(pdf), {
    headers: {
      "Content-Type": "application/pdf",
      "Content-Disposition": `inline; filename="facture-${invoice.number}.pdf"`,
      "Cache-Control": "private, no-store",
      // Le lien d'un invité porte son jeton : il ne doit fuiter ni par le référent ni par un moteur.
      "Referrer-Policy": "no-referrer",
      "X-Robots-Tag": "noindex",
    },
  });
}
