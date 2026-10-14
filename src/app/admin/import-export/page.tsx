import type { Metadata } from "next";
import { linkButtonClass, PageHeader, Section } from "@/components/admin/admin-ui";
import { requirePermission } from "@/server/auth/session";
import { MAX_IMPORT_ROWS } from "@/server/modules/catalog/csv-import-plan";
import { ImportForm } from "./import-form";

export const metadata: Metadata = { title: "Import / export", robots: { index: false } };

export default async function ImportExportPage() {
  const user = await requirePermission("products.read", "/admin/import-export");
  const canImport = user.permissions.has("products.update") || user.permissions.has("inventory.adjust");

  return (
    <div className="flex flex-col gap-6">
      <PageHeader title="Import / export du catalogue" />
      <Section title="Exporter">
        <p className="mb-3 text-sm text-ink-muted">
          Une ligne par version : référence, produit, catégorie, prix, stock. Format CSV « ; » compatible Excel et LibreOffice.
        </p>
        {/* Lien de téléchargement direct (route GET), pas de navigation client. */}
        <a href="/admin/import-export/catalogue.csv" className={linkButtonClass} download>
          Télécharger le catalogue (CSV)
        </a>
      </Section>
      {canImport && (
        <Section title="Importer des mises à jour">
          <div className="mb-4 space-y-2 text-sm text-ink-muted">
            <p>
              L&apos;import met à jour des versions <strong>existantes</strong>, repérées par la colonne <code>sku</code>. Il ne crée ni ne
              supprime aucun produit. Partez du fichier exporté.
            </p>
            <ul className="list-disc pl-5">
              <li>
                Colonnes prises en compte : <code>prix</code>, <code>prix_barre</code> (0 pour retirer la promotion), <code>prix_achat</code>,{" "}
                <code>seuil_alerte</code>, <code>stock_compte</code>. Les autres colonnes sont ignorées.
              </li>
              <li>Une cellule vide laisse la valeur inchangée.</li>
              <li>
                <code>stock_compte</code> est la quantité comptée lors d&apos;un inventaire : l&apos;écart est enregistré comme mouvement
                d&apos;inventaire dans le journal de stock.
              </li>
              <li>Tout ou rien : une seule ligne en erreur et rien n&apos;est modifié. {MAX_IMPORT_ROWS} lignes et 2 Mo maximum.</li>
            </ul>
          </div>
          <ImportForm />
        </Section>
      )}
    </div>
  );
}
