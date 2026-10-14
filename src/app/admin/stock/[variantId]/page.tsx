import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { PageHeader, Section } from "@/components/admin/admin-ui";
import { ActionForm, IntegerField, SelectField, SubmitButton, TextField } from "@/components/admin/form-controls";
import { MovementsTable } from "@/components/admin/movements-table";
import { formatDateTime } from "@/lib/dates";
import { requirePermission } from "@/server/auth/session";
import { db } from "@/server/db/client";
import { getVariantStock } from "@/server/modules/inventory/queries";
import { listStockMovements } from "@/server/modules/inventory/service";
import { recordMovementAction, setThresholdAction } from "../actions";

export const metadata: Metadata = { title: "Gestion du stock", robots: { index: false } };

const MOVEMENT_OPTIONS = [
  { value: "IN", label: "Entrée (réception, retour fournisseur annulé…)" },
  { value: "OUT", label: "Sortie (casse, perte, usage interne…)" },
  { value: "ADJUSTMENT", label: "Inventaire (saisir la quantité comptée)" },
];

function Figure({ label, value }: { label: string; value: number }) {
  return (
    <div className="rounded-lg bg-surface-muted p-3">
      <dt className="text-xs uppercase text-ink-muted">{label}</dt>
      <dd className="text-2xl font-bold">{value}</dd>
    </div>
  );
}

export default async function VariantStockPage({ params }: { params: Promise<{ variantId: string }> }) {
  const { variantId } = await params;
  const user = await requirePermission("inventory.read", `/admin/stock/${variantId}`);
  const stock = await getVariantStock(db, user, variantId);
  if (!stock) notFound();
  const movements = await listStockMovements(db, user, { variantId });
  const canAdjust = user.permissions.has("inventory.adjust");

  return (
    <div className="flex flex-col gap-6">
      <PageHeader title={`${stock.productName} — ${stock.variantName}`}>
        {user.permissions.has("products.read") && (
          <Link href={`/admin/produits/${stock.productId}`} className="text-sm text-brand-blue underline">
            Fiche produit
          </Link>
        )}
      </PageHeader>
      <p className="-mt-4 font-mono text-sm text-ink-muted">{stock.sku}</p>

      <dl className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        <Figure label="Physique" value={stock.onHand} />
        <Figure label="Réservé" value={stock.reserved} />
        <Figure label="Disponible" value={stock.onHand - stock.reserved} />
        <Figure label="Seuil d'alerte" value={stock.alertThreshold} />
      </dl>
      {stock.lastCountedAt && (
        <p className="text-sm text-ink-muted">
          Dernier inventaire : {stock.lastCountedQty} unité(s) le {formatDateTime(stock.lastCountedAt)}.
        </p>
      )}

      {canAdjust && (
        <div className="grid gap-6 lg:grid-cols-2">
          <Section title="Enregistrer un mouvement">
            <ActionForm action={recordMovementAction.bind(null, stock.variantId)} resetOnSuccess>
              <SelectField name="type" label="Type" options={MOVEMENT_OPTIONS} defaultValue="IN" />
              <IntegerField name="quantity" label="Quantité" hint="Pour un inventaire : la quantité réellement comptée en rayon." />
              <TextField name="reason" label="Motif" hint="Obligatoire : bon de réception, casse constatée, inventaire mensuel…" />
              <div>
                <SubmitButton>Enregistrer</SubmitButton>
              </div>
            </ActionForm>
          </Section>
          <Section title="Seuil d'alerte">
            <ActionForm action={setThresholdAction.bind(null, stock.variantId)}>
              <IntegerField name="alertThreshold" label="Alerter quand le disponible atteint" defaultValue={stock.alertThreshold} />
              <div>
                <SubmitButton>Enregistrer le seuil</SubmitButton>
              </div>
            </ActionForm>
          </Section>
        </div>
      )}

      <Section title="Derniers mouvements">
        <MovementsTable movements={movements} />
      </Section>
    </div>
  );
}
