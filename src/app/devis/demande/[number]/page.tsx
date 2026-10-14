import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { InterventionFollowUp } from "@/components/services/intervention-follow-up";
import { formatDate, formatDateTime } from "@/lib/dates";
import { QUOTE_REQUEST_STATUS_LABELS, QUOTE_STATUS_LABELS, URGENCY_LABELS } from "@/lib/labels";
import { formatFcfa } from "@/lib/money";
import { getCurrentUser } from "@/server/auth/session";
import { db } from "@/server/db/client";
import { getRequestForViewer } from "@/server/modules/quotes/queries";

export const metadata: Metadata = { title: "Suivi de demande", robots: { index: false }, referrer: "no-referrer" };

type Props = { params: Promise<{ number: string }>; searchParams: Promise<Record<string, string | string[] | undefined>> };

/** Suivi d'une demande : compte connecté, ou invité avec le jeton de son lien. */
export default async function QuoteRequestTrackingPage({ params, searchParams }: Props) {
  const { number } = await params;
  const token = (await searchParams).jeton;
  const user = await getCurrentUser();
  const request = await getRequestForViewer(db, { userId: user?.id ?? null, token: typeof token === "string" ? token : undefined }, number);
  if (!request) notFound();
  // Invité : les documents d'une intervention sans devis s'ouvrent avec le jeton de ce lien.
  const documentQuery = typeof token === "string" ? `?jeton=${encodeURIComponent(token)}` : "";

  return (
    <main className="mx-auto max-w-3xl px-4 py-8">
      <h1 className="text-2xl font-bold">Demande {request.number}</h1>
      {request.status === "NEW" && (
        <p role="status" className="mt-4 rounded-lg border border-green-200 bg-green-50 p-3 text-green-900">
          Merci ! Votre demande est enregistrée. Nous vous appelons au {request.contact.phone} pour la préciser.
        </p>
      )}
      {!user && <p className="mt-3 text-sm text-ink-muted">Conservez l&apos;adresse de cette page (favori) : c&apos;est votre lien de suivi personnel.</p>}

      <dl className="mt-6 grid gap-x-6 gap-y-2 rounded-xl border border-line bg-surface p-4 text-sm sm:grid-cols-[12rem_1fr]">
        <dt className="text-ink-muted">Statut</dt>
        <dd className="font-semibold">{QUOTE_REQUEST_STATUS_LABELS[request.status]}</dd>
        {request.closingNote && (
          <>
            <dt className="text-ink-muted">Motif</dt>
            <dd>{request.closingNote}</dd>
          </>
        )}
        <dt className="text-ink-muted">Déposée le</dt>
        <dd>{formatDateTime(request.createdAt)}</dd>
        {request.serviceName && (
          <>
            <dt className="text-ink-muted">Service</dt>
            <dd>{request.serviceName}</dd>
          </>
        )}
        <dt className="text-ink-muted">Urgence</dt>
        <dd>{URGENCY_LABELS[request.urgency]}</dd>
        <dt className="text-ink-muted">Adresse</dt>
        <dd>{request.address}</dd>
        <dt className="text-ink-muted">Besoin</dt>
        <dd className="whitespace-pre-line">{request.description}</dd>
      </dl>

      <section aria-labelledby="devis-recus" className="mt-6">
        <h2 id="devis-recus" className="text-lg font-semibold">
          Devis
        </h2>
        {request.quotes.length === 0 ? (
          <p className="mt-2 text-sm text-ink-muted">Aucun devis pour le moment : nous étudions votre demande.</p>
        ) : (
          <ul className="mt-2 divide-y divide-line rounded-xl border border-line bg-surface">
            {request.quotes.map((quote) => (
              <li key={quote.number} className="flex flex-wrap items-center justify-between gap-2 p-4">
                <div>
                  <Link href={quote.href} className="font-semibold text-brand-blue underline">
                    Devis {quote.number}
                  </Link>
                  <p className="text-sm text-ink-muted">Valable jusqu&apos;au {formatDate(quote.validUntil)}</p>
                </div>
                <div className="text-right">
                  <p className="font-semibold">{formatFcfa(quote.total)}</p>
                  <p className="text-sm">{QUOTE_STATUS_LABELS[quote.status]}</p>
                </div>
              </li>
            ))}
          </ul>
        )}
      </section>

      {request.directIntervention && <InterventionFollowUp intervention={request.directIntervention} documentQuery={documentQuery} />}
    </main>
  );
}
