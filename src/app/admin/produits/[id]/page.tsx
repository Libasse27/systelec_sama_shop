import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { PageHeader, Section, secondaryLinkClass, StatusBadge } from "@/components/admin/admin-ui";
import { categoryOptions } from "@/components/admin/category-options";
import { ActionForm, SubmitButton } from "@/components/forms/form-controls";
import { ProductFields } from "@/components/admin/product-fields";
import { formatFcfa } from "@/lib/money";
import { requirePermission } from "@/server/auth/session";
import { db } from "@/server/db/client";
import { listAdminCategories } from "@/server/modules/catalog/admin-categories";
import { getAdminProduct, type AdminProduct } from "@/server/modules/catalog/admin-queries";
import { setProductStatusAction, updateProductAction } from "../actions";
import { ProductImages } from "./product-images";
import { ProductVariants } from "./product-variants";

export const metadata: Metadata = { title: "Fiche produit", robots: { index: false } };

function StatusActions({ product, canUpdate, canArchive }: { product: AdminProduct; canUpdate: boolean; canArchive: boolean }) {
  const actions = [
    product.status !== "PUBLISHED" && canUpdate && { status: "PUBLISHED" as const, label: "Publier", variant: "primary" as const },
    product.status === "PUBLISHED" && canUpdate && { status: "DRAFT" as const, label: "Repasser en brouillon", variant: "secondary" as const },
    product.status === "ARCHIVED" && canUpdate && { status: "DRAFT" as const, label: "Désarchiver (brouillon)", variant: "secondary" as const },
    product.status !== "ARCHIVED" && canArchive && { status: "ARCHIVED" as const, label: "Archiver", variant: "danger" as const },
  ].filter((action) => action !== false);
  if (actions.length === 0) return null;
  // Un seul formulaire : son message reste affiché même quand les boutons changent.
  return (
    <ActionForm action={setProductStatusAction.bind(null, product.id)} className="gap-2">
      <div className="flex flex-wrap gap-2">
        {actions.map((action) => (
          <SubmitButton
            key={action.label}
            name="status"
            value={action.status}
            variant={action.variant}
            confirm={action.status === "ARCHIVED" ? "Archiver ce produit ? Il disparaîtra de la boutique." : undefined}
          >
            {action.label}
          </SubmitButton>
        ))}
      </div>
    </ActionForm>
  );
}

function ReadOnlyVariants({ product }: { product: AdminProduct }) {
  return (
    <ul className="divide-y divide-line">
      {product.variants.map((variant) => (
        <li key={variant.id} className="flex flex-wrap justify-between gap-2 py-2 text-sm">
          <span>
            {variant.name} · <span className="font-mono">{variant.sku}</span>
            {!variant.isActive && " (hors vente)"}
          </span>
          <span>
            {formatFcfa(variant.price)} · stock {variant.onHand} (réservé {variant.reserved})
          </span>
        </li>
      ))}
    </ul>
  );
}

export default async function AdminProductPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const user = await requirePermission("products.read", `/admin/produits/${id}`);
  const product = await getAdminProduct(db, user, id);
  if (!product) notFound();
  const canUpdate = user.permissions.has("products.update");
  const canArchive = user.permissions.has("products.archive");
  const canSeeStock = user.permissions.has("inventory.read");

  return (
    <div className="flex flex-col gap-6">
      <PageHeader title={product.name}>
        <StatusBadge status={product.status} />
        {product.status === "PUBLISHED" && (
          <Link href={`/produits/${product.slug}`} className={secondaryLinkClass} target="_blank">
            Voir sur la boutique
          </Link>
        )}
      </PageHeader>

      <StatusActions product={product} canUpdate={canUpdate} canArchive={canArchive} />

      {canUpdate ? (
        <>
          <ActionForm action={updateProductAction.bind(null, product.id)}>
            <Section title="Fiche produit">
              <ProductFields product={product} categories={categoryOptions(await listAdminCategories(db, user))} />
            </Section>
            <div>
              <SubmitButton>Enregistrer la fiche</SubmitButton>
            </div>
          </ActionForm>
          <ProductVariants product={product} canSeeStock={canSeeStock} />
          <ProductImages product={product} />
        </>
      ) : (
        <Section title="Versions">
          <ReadOnlyVariants product={product} />
        </Section>
      )}
    </div>
  );
}
