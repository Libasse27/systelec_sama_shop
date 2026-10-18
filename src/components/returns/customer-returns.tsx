import { randomUUID } from "node:crypto";
import { ActionForm, FileField, IntegerField, SelectField, SubmitButton, TextAreaField } from "@/components/forms/form-controls";
import { formatDateTime } from "@/lib/dates";
import { CUSTOMER_RETURN_REASON_LABELS, RETURN_CUSTOMER_STATUS_LABELS, RETURN_VERIFICATION_KIND_LABELS } from "@/lib/labels";
import { formatFcfa } from "@/lib/money";
import type { CustomerReturnLine, CustomerReturnView } from "@/server/modules/returns/customer";
import { RETURN_DECLARATION_HOURS } from "@/server/modules/returns/policy";
import { answerReturnAction, declareReturnAction } from "@/app/retours/actions";

const PHOTO_HINT = "Facultatif : jusqu'à 3 photos (JPEG, PNG ou WebP, 2 Mo chacune) du produit ou du défaut.";
const reasonOptions = Object.entries(CUSTOMER_RETURN_REASON_LABELS).map(([value, label]) => ({ value, label }));

interface CustomerReturnsProps {
  orderNumber: string;
  /** Jeton du lien de suivi (commande invitée), ou null pour un compte connecté. */
  token: string | null;
  canDeclare: boolean;
  returnable: CustomerReturnLine[];
  returns: CustomerReturnView[];
}

function ReturnCard({ entry, orderNumber, token }: { entry: CustomerReturnView; orderNumber: string; token: string | null }) {
  return (
    <li className="rounded-lg border border-line p-3 text-sm">
      <p>
        <span className="font-semibold">Retour {entry.number}</span> · {RETURN_CUSTOMER_STATUS_LABELS[entry.status]} · déclaré le {formatDateTime(entry.createdAt)}
        {entry.lateDeclaration && " (après le délai de 48 heures)"}
      </p>
      <p className="text-ink-muted">
        {entry.items.map((item) => `${item.quantity} × ${item.productName} — ${item.variantName}`).join(", ")}
        {entry.photos > 0 && ` · ${entry.photos} photo(s) jointe(s)`}
      </p>
      {entry.decision?.outcome === "ACCEPTED" && (
        <p className="mt-1">
          Demande acceptée.
          {entry.decision.refundAmount > 0 &&
            (entry.refunded ? ` Remboursement de ${formatFcfa(entry.decision.refundAmount)} versé.` : ` Remboursement prévu : ${formatFcfa(entry.decision.refundAmount)}, en espèces à la boutique.`)}
        </p>
      )}
      {entry.decision?.outcome === "REJECTED" && <p className="mt-1">Demande refusée{entry.decision.note && ` : ${entry.decision.note}`}.</p>}
      {/* Formulaire toujours monté : son message de confirmation reste visible après l'envoi. */}
      <ActionForm action={answerReturnAction.bind(null, orderNumber, entry.number, token)} resetOnSuccess className="mt-3">
        {entry.pendingRequest && (
          <>
            <p className="rounded-lg border border-amber-200 bg-amber-50 px-3 py-2">
              <strong>{RETURN_VERIFICATION_KIND_LABELS[entry.pendingRequest.kind]}</strong> demandée : {entry.pendingRequest.request}
            </p>
            <TextAreaField name="response" label="Votre réponse" rows={3} />
            <FileField name="photos" label="Photos" accept="image/jpeg,image/png,image/webp" multiple required={false} hint={PHOTO_HINT} />
            <div>
              <SubmitButton>Envoyer ma réponse</SubmitButton>
            </div>
          </>
        )}
      </ActionForm>
    </li>
  );
}

/**
 * Retours d'une commande côté client (phase 10, décision 2) : suivi des demandes et déclaration d'un
 * nouveau retour sur une commande remise. La déclaration ne déclenche aucun remboursement.
 */
export function CustomerReturns({ orderNumber, token, canDeclare, returnable, returns }: CustomerReturnsProps) {
  if (!canDeclare && returns.length === 0) return null;
  return (
    <section aria-labelledby="retours" className="mt-8 rounded-xl border border-line p-4">
      <h2 id="retours" className="text-lg font-semibold">
        Retours et réclamations
      </h2>
      {returns.length > 0 && (
        <ul className="mt-3 flex flex-col gap-3">
          {returns.map((entry) => (
            <ReturnCard key={entry.number} entry={entry} orderNumber={orderNumber} token={token} />
          ))}
        </ul>
      )}
      {canDeclare && (
        <details className="mt-4">
          <summary className="cursor-pointer font-medium text-brand-blue">Signaler un produit endommagé, défectueux ou non conforme</summary>
          <p className="mt-2 text-sm text-ink-muted">
            Signalez le problème dans les {RETURN_DECLARATION_HOURS} heures qui suivent la remise. Une demande plus tardive est tout de même examinée (garantie,
            défaut caché, droits légaux). Notre équipe examine chaque demande avant toute décision ; aucun remboursement n&apos;est automatique.
          </p>
          <ActionForm action={declareReturnAction.bind(null, orderNumber, token)} resetOnSuccess className="mt-3">
            <input type="hidden" name="idempotencyKey" value={randomUUID()} />
            <fieldset className="flex flex-col gap-2">
              <legend className="mb-1 text-sm font-medium">Articles concernés (quantité)</legend>
              {returnable
                .filter((line) => line.remaining > 0)
                .map((line) => (
                  <div key={line.orderItemId} className="flex items-end gap-3">
                    <input type="hidden" name="orderItemId" value={line.orderItemId} />
                    <IntegerField name={`quantity-${line.orderItemId}`} label={`${line.productName} — ${line.variantName} (au plus ${line.remaining})`} defaultValue={0} />
                  </div>
                ))}
            </fieldset>
            <SelectField name="category" label="Motif" options={reasonOptions} />
            <TextAreaField name="description" label="Description du problème" rows={3} hint="Ce que vous constatez, depuis quand, dans quelles conditions." />
            <FileField name="photos" label="Photos" accept="image/jpeg,image/png,image/webp" multiple required={false} hint={PHOTO_HINT} />
            <div>
              <SubmitButton>Envoyer ma demande</SubmitButton>
            </div>
          </ActionForm>
        </details>
      )}
    </section>
  );
}
