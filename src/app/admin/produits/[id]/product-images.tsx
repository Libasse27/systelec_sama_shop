import { Section } from "@/components/admin/admin-ui";
import { ActionForm, FileField, SubmitButton, TextField } from "@/components/admin/form-controls";
import type { AdminProduct } from "@/server/modules/catalog/admin-queries";
import { MAX_IMAGES_PER_PRODUCT } from "@/server/modules/catalog/admin-images";
import { addImageAction, deleteImageAction, moveImageAction, updateImageAltAction } from "../actions";

/** Images du produit : la première est l'image principale (listes, partage). */
export function ProductImages({ product }: { product: AdminProduct }) {
  const { images } = product;
  return (
    <Section title={`Images (${images.length}/${MAX_IMAGES_PER_PRODUCT})`}>
      {images.length > 0 && (
        <ol className="mb-6 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {images.map((image, index) => (
            <li key={image.id} className="flex flex-col gap-2 rounded-lg border border-line p-3">
              {/* eslint-disable-next-line @next/next/no-img-element -- fichiers servis par /medias */}
              <img src={image.url} alt={image.alt} className="aspect-square w-full rounded-md bg-surface-muted object-contain" />
              {index === 0 && <p className="text-xs font-semibold text-brand-blue">Image principale</p>}
              <ActionForm action={updateImageAltAction.bind(null, product.id, image.id)} className="gap-2">
                <TextField name="alt" label="Description (accessibilité)" defaultValue={image.alt} />
                <div>
                  <SubmitButton variant="secondary">Enregistrer</SubmitButton>
                </div>
              </ActionForm>
              <div className="flex flex-wrap gap-2">
                {index > 0 && (
                  <ActionForm action={moveImageAction.bind(null, product.id, image.id, "up")}>
                    <SubmitButton variant="secondary">Avancer</SubmitButton>
                  </ActionForm>
                )}
                {index < images.length - 1 && (
                  <ActionForm action={moveImageAction.bind(null, product.id, image.id, "down")}>
                    <SubmitButton variant="secondary">Reculer</SubmitButton>
                  </ActionForm>
                )}
                <ActionForm action={deleteImageAction.bind(null, product.id, image.id)} confirm="Supprimer définitivement cette image ?">
                  <SubmitButton variant="danger">Supprimer</SubmitButton>
                </ActionForm>
              </div>
            </li>
          ))}
        </ol>
      )}
      {images.length < MAX_IMAGES_PER_PRODUCT && (
        <ActionForm action={addImageAction.bind(null, product.id)} resetOnSuccess className="max-w-md">
          <FileField name="image" label="Nouvelle image" accept="image/jpeg,image/png,image/webp" hint="JPEG, PNG ou WebP, 5 Mo maximum." />
          <TextField name="alt" label="Description de l'image" hint="Ce que montre l'image (lue par les lecteurs d'écran)." />
          <div>
            <SubmitButton>Téléverser</SubmitButton>
          </div>
        </ActionForm>
      )}
    </Section>
  );
}
