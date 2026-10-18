import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { randomUUID } from "node:crypto";
import { PageHeader, Section } from "@/components/admin/admin-ui";
import { ActionForm, CheckboxField, IntegerField, SelectField, SubmitButton, TextAreaField, TextField } from "@/components/forms/form-controls";
import { formatDateTime } from "@/lib/dates";
import { RETURN_EVENT_LABELS, RETURN_EXCEPTION_GROUND_LABELS, RETURN_STATUS_LABELS, RETURN_VERIFICATION_KIND_LABELS } from "@/lib/labels";
import { formatFcfa } from "@/lib/money";
import { requirePermission, type CurrentUser } from "@/server/auth/session";
import { db } from "@/server/db/client";
import { RETURN_DECLARATION_HOURS, RETURN_PROCESSING_BUSINESS_HOURS } from "@/server/modules/returns/policy";
import { getReturn, type ReturnView } from "@/server/modules/returns/queries";
import { answerVerificationAction, decideReturnAction, refundReturnAction, requestVerificationAction } from "../actions";

export const metadata: Metadata = { title: "Retour", robots: { index: false } };

const options = (labels: Record<string, string>) => Object.entries(labels).map(([value, label]) => ({ value, label }));

function Deadlines({ entry }: { entry: ReturnView }) {
  return (
    <dl className="grid gap-x-6 gap-y-1 text-sm sm:grid-cols-[16rem_1fr]">
      <dt className="text-ink-muted">Remis au client le</dt>
      <dd>{formatDateTime(entry.handedOverAt)}</dd>
      <dt className="text-ink-muted">Déclaration attendue avant le</dt>
      <dd>
        {formatDateTime(entry.declarationDeadline)} ({RETURN_DECLARATION_HOURS} h)
        {entry.lateDeclaration && (
          <span className="ml-2 rounded-md bg-amber-100 px-2 py-0.5 text-xs font-semibold text-amber-900">Hors délai</span>
        )}
      </dd>
      <dt className="text-ink-muted">Traitement à commencer avant le</dt>
      <dd>
        {formatDateTime(entry.processingDueAt)} ({RETURN_PROCESSING_BUSINESS_HOURS} heures ouvrables)
        {entry.firstActionAt && <span className="text-ink-muted"> · commencé le {formatDateTime(entry.firstActionAt)}</span>}
        {entry.processingOverdue && (
          <span className="ml-2 rounded-md bg-red-100 px-2 py-0.5 text-xs font-semibold text-red-900">
            En retard{entry.overdueNotifiedAt && ` : administrateurs alertés le ${formatDateTime(entry.overdueNotifiedAt)}`}
          </span>
        )}
      </dd>
    </dl>
  );
}

function VerificationForms({ entry, user }: { entry: ReturnView; user: CurrentUser }) {
  const canDecide = user.permissions.has("returns.decide");
  // Validation indépendante : le déclarant ne demande ni n'enregistre lui-même une vérification.
  const canAnswer = canDecide && entry.createdById !== user.id;
  return (
    <>
      {/* Formulaires toujours montés : leur message de confirmation reste visible après l'étape. */}
      {!canAnswer && entry.pendingVerification && (
        <p className="rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-sm">
          <strong>{RETURN_VERIFICATION_KIND_LABELS[entry.pendingVerification.kind]}</strong> demandée le {formatDateTime(entry.pendingVerification.requestedAt)} :{" "}
          {entry.pendingVerification.request}. Un responsable autre que le déclarant enregistre le résultat.
        </p>
      )}
      {canAnswer && (
        <ActionForm action={answerVerificationAction.bind(null, entry.id)} resetOnSuccess>
          {entry.pendingVerification && (
            <>
              <p className="rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-sm">
                <strong>{RETURN_VERIFICATION_KIND_LABELS[entry.pendingVerification.kind]}</strong> demandée le {formatDateTime(entry.pendingVerification.requestedAt)}
                {entry.pendingVerification.requestedBy && ` par ${entry.pendingVerification.requestedBy}`} : {entry.pendingVerification.request}
              </p>
              <TextAreaField name="response" label="Réponse ou résultat de la vérification" rows={3} />
              <div>
                <SubmitButton>Enregistrer la réponse</SubmitButton>
              </div>
            </>
          )}
        </ActionForm>
      )}
      {canAnswer && (
        <ActionForm action={requestVerificationAction.bind(null, entry.id)} resetOnSuccess>
          {entry.status === "RECEIVED" && (
            <>
              <h3 className="text-sm font-semibold">Demander une vérification avant de décider</h3>
              <div className="grid gap-3 sm:grid-cols-2">
                <SelectField name="kind" label="Nature de la vérification" options={options(RETURN_VERIFICATION_KIND_LABELS)} />
                <TextField name="request" label="Précisions demandées" hint="Ex. : photos de l'écran et de l'emballage." />
              </div>
              <div>
                <SubmitButton variant="secondary">Demander la vérification</SubmitButton>
              </div>
            </>
          )}
        </ActionForm>
      )}
    </>
  );
}

function DecisionForm({ entry, user }: { entry: ReturnView; user: CurrentUser }) {
  if (!user.permissions.has("returns.decide")) return null;
  if (entry.createdById === user.id) {
    return entry.status === "RECEIVED" ? (
      <p className="text-sm text-ink-muted">Vous avez déclaré ce retour : un autre responsable doit l&apos;accepter ou le refuser (validation indépendante).</p>
    ) : null;
  }
  return (
    <ActionForm action={decideReturnAction.bind(null, entry.id)}>
      {entry.status === "RECEIVED" && (
        <>
          <h3 className="text-sm font-semibold">Décision</h3>
          <div className="grid gap-3 sm:grid-cols-2">
            <IntegerField
              name="refundAmount"
              label="Montant à rembourser (FCFA)"
              defaultValue={entry.maxRefund}
              hint={`Au plus ${formatFcfa(entry.maxRefund)} (remise de la commande déduite, frais de livraison non compris). 0 : aucun remboursement. Le versement sera validé à part.`}
            />
            <TextField name="note" label="Motif de la décision" hint="État des articles, remise en stock ou non, motif du refus." />
          </div>
          <CheckboxField name="restock" label="Remettre les articles en stock (intacts et revendables)" defaultChecked />
          {entry.lateDeclaration && (
            <fieldset className="grid gap-3 rounded-lg border border-amber-200 bg-amber-50 p-3 sm:grid-cols-2">
              <legend className="px-1 text-sm font-semibold">Exception : retour déclaré hors délai</legend>
              <SelectField name="exceptionGround" label="Fondement de l'exception" options={options(RETURN_EXCEPTION_GROUND_LABELS)} required={false} />
              <TextField name="exceptionNote" label="Motif de l'exception" required={false} hint="Obligatoire pour accepter ce retour." />
            </fieldset>
          )}
          <div className="flex flex-wrap gap-2">
            <SubmitButton name="decision" value="ACCEPT" confirm="Accepter ce retour ? La décision est définitive.">
              Accepter le retour
            </SubmitButton>
            <SubmitButton name="decision" value="REJECT" variant="danger" confirm="Refuser ce retour ? Les articles sont rendus au client.">
              Refuser
            </SubmitButton>
          </div>
        </>
      )}
    </ActionForm>
  );
}

function DecisionSummary({ entry }: { entry: ReturnView }) {
  if (!entry.decidedAt) return null;
  return (
    <div className="text-sm">
      Décision du {formatDateTime(entry.decidedAt)}
      {entry.decidedBy && ` (${entry.decidedBy})`} : {entry.decisionNote}
      {entry.restocked !== null && ` · ${entry.restocked ? "remis en stock" : "non remis en stock"}`}
      {entry.status !== "REJECTED" && ` · remboursement ${formatFcfa(entry.refundAmount)}`}
      {entry.exceptionGround && (
        <div>
          Exception ({RETURN_EXCEPTION_GROUND_LABELS[entry.exceptionGround]}) : {entry.exceptionNote}
        </div>
      )}
      {entry.refundReceipt && (
        <div>
          Remboursé :{" "}
          <a href={`/recus/${entry.refundReceipt}`} target="_blank" rel="noopener" className="text-brand-blue underline">
            reçu {entry.refundReceipt}
          </a>
        </div>
      )}
    </div>
  );
}

/** Fiche d'un retour : délais (décision 2), vérification, décision indépendante, remboursement, historique. */
export default async function ReturnPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const user = await requirePermission("orders.read", `/admin/retours/${id}`);
  const entry = await getReturn(db, user, id);
  if (!entry) notFound();

  return (
    <div className="flex flex-col gap-6">
      <PageHeader title={`Retour ${entry.number}`} />
      <Section title="Demande">
        <div className="flex flex-col gap-2 text-sm">
          <p>
            <span className="font-semibold">{RETURN_STATUS_LABELS[entry.status]}</span> · commande{" "}
            <Link href={`/admin/commandes/${entry.orderId}`} className="font-medium text-brand-blue underline">
              {entry.orderNumber}
            </Link>{" "}
            · {entry.customerName}
          </p>
          <p>
            Déclaré le {formatDateTime(entry.createdAt)}
            {entry.createdBy && ` par ${entry.createdBy}`}, au nom du client. Motif : {entry.reason}
          </p>
          <ul>
            {entry.items.map((item) => (
              <li key={item.sku}>
                {item.quantity} × {item.productName} — {item.variantName} ({formatFcfa(item.unitPrice)})
              </li>
            ))}
          </ul>
          <p>Valeur : {formatFcfa(entry.itemsValue)}</p>
          <DecisionSummary entry={entry} />
        </div>
      </Section>

      <Section title="Délais">
        <Deadlines entry={entry} />
        {entry.lateDeclaration && (
          <p className="mt-3 text-sm text-ink-muted">
            Déclaré après le délai commercial de {RETURN_DECLARATION_HOURS} h. Ce délai ne limite pas les droits légaux du client : le retour peut être accepté au titre
            de la garantie, d&apos;un vice caché ou d&apos;une obligation légale, avec un motif d&apos;exception.
          </p>
        )}
      </Section>

      <Section title="Traitement">
        <div className="flex flex-col gap-4">
          <VerificationForms entry={entry} user={user} />
          <DecisionForm entry={entry} user={user} />
          {user.permissions.has("payments.correct") && entry.refundAmount > 0 && (
            <ActionForm action={refundReturnAction.bind(null, entry.id)}>
              {entry.status === "REFUND_PENDING" ? (
                <div className="flex flex-wrap items-end gap-2">
                  <input type="hidden" name="idempotencyKey" value={randomUUID()} />
                  <TextField name="note" label="Note interne" required={false} className="min-w-56 flex-1" />
                  <SubmitButton confirm={`Valider et verser ${formatFcfa(entry.refundAmount)} en espèces au client ?`}>
                    Rembourser {formatFcfa(entry.refundAmount)} en espèces
                  </SubmitButton>
                </div>
              ) : null}
            </ActionForm>
          )}
          {entry.status === "REFUND_PENDING" && !user.permissions.has("payments.correct") && (
            <p className="text-sm text-ink-muted">Remboursement à valider et verser par une personne autorisée (finances).</p>
          )}
        </div>
      </Section>

      <Section title="Historique du retour">
        <ol className="flex flex-col gap-2 text-sm">
          {entry.events.map((event) => (
            <li key={event.id}>
              {formatDateTime(event.createdAt)} — <span className="font-medium">{RETURN_EVENT_LABELS[event.type]}</span> ({RETURN_STATUS_LABELS[event.toStatus]})
              {` · ${event.actorName ?? "système"}`}
              {event.verificationKind && ` · ${RETURN_VERIFICATION_KIND_LABELS[event.verificationKind]}`}
              {event.comment && <div className="text-ink-muted">{event.comment}</div>}
            </li>
          ))}
        </ol>
      </Section>
    </div>
  );
}
