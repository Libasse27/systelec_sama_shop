import { expect, test, type Page } from "@playwright/test";
import { grantRole } from "./support/db";

const PASSWORD = "motdepasse-e2e-solide";
// Image PNG 1×1 valide.
const PNG_1PX = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==",
  "base64",
);

/** Identifiant d'URL dérivé du nom, comme le fait le serveur. */
async function categorySlug(name: string): Promise<string> {
  const { slugify } = await import("../src/lib/slug");
  return slugify(name);
}

async function signUpStaff(page: Page, roles: string[]): Promise<void> {
  const email = `e2e-admin-${Date.now()}-${Math.random().toString(36).slice(2, 8)}@example.sn`;
  await page.goto("/inscription");
  await page.getByLabel("Nom complet").fill("Gestionnaire E2E");
  await page.getByLabel("E-mail").fill(email);
  await page.getByLabel("Mot de passe").fill(PASSWORD);
  await page.getByRole("button", { name: "Créer mon compte" }).click();
  await expect(page).toHaveURL(/\/compte$/);
  for (const role of roles) await grantRole(email, role);
}

test.describe("administration du catalogue et du stock (§20 n° 4 et 6)", () => {
  test("créer un produit, ajouter une image, le publier puis réceptionner du stock", async ({ page }) => {
    await signUpStaff(page, ["CATALOG_MANAGER", "STOCK_MANAGER"]);
    const suffix = `${Date.now()}${Math.random().toString(36).slice(2, 6)}`;
    const name = `Onduleur E2E ${suffix}`;

    // Catégorie propre au test : les produits publiés ne faussent pas les comptes de la boutique de démo.
    const category = `Catégorie E2E ${suffix}`;
    await page.goto("/admin/categories");
    await page.getByLabel("Nom", { exact: true }).fill(category);
    await page.getByRole("button", { name: "Créer la catégorie" }).click();
    await expect(page.getByText("Catégorie créée.")).toBeVisible();

    await page.goto("/admin/produits/nouveau");
    await page.getByLabel("Catégorie").selectOption({ label: category });
    await page.getByLabel("Nom du produit").fill(name);
    await page.getByLabel("Description courte").fill("Onduleur 1000 VA pour poste de travail.");
    await page.getByLabel("Description détaillée").fill("Onduleur line-interactive 1000 VA, 4 prises, protection parafoudre.");
    await page.getByLabel("Caractéristiques techniques").fill("Puissance : 1000 VA\nPrises : 4");
    await page.getByLabel("Référence (SKU)").fill(`UPS-${suffix}`);
    await page.getByLabel("Prix de vente TTC (FCFA)").fill("85 000");
    await page.getByLabel("Prix barré (FCFA)").fill("95000");
    await page.getByRole("button", { name: "Créer le produit" }).click();
    await expect(page).toHaveURL(/\/admin\/produits\/[a-z0-9]+$/);
    await expect(page.getByRole("heading", { name })).toBeVisible();

    await page.getByLabel("Nouvelle image").setInputFiles({ name: "onduleur.png", mimeType: "image/png", buffer: PNG_1PX });
    await page.getByLabel("Description de l'image").fill("Onduleur vu de face");
    await page.getByRole("button", { name: "Téléverser" }).click();
    await expect(page.getByText("Image ajoutée.")).toBeVisible();
    await expect(page.getByRole("img", { name: "Onduleur vu de face" })).toBeVisible();

    await page.getByRole("button", { name: "Publier" }).click();
    await expect(page.getByText("Produit publié")).toBeVisible();

    await page.getByRole("link", { name: "Gérer le stock" }).click();
    await page.getByLabel("Quantité").fill("5");
    await page.getByLabel("Motif").fill("Réception bon n° 42");
    await page.getByRole("button", { name: "Enregistrer", exact: true }).click();
    await expect(page.getByText("Entrée enregistrée.")).toBeVisible();
    await expect(page.getByRole("cell", { name: "Réception bon n° 42" })).toBeVisible();

    await page.getByRole("link", { name: "Fiche produit" }).click();
    await page.getByRole("link", { name: "Voir sur la boutique" }).evaluate((link) => link.removeAttribute("target"));
    await page.getByRole("link", { name: "Voir sur la boutique" }).click();
    await expect(page.getByRole("heading", { level: 1, name })).toBeVisible();
    const image = page.getByRole("img", { name: "Onduleur vu de face" }).first();
    await expect(image).toHaveAttribute("src", /^\/medias\/produits\//);
    expect(await image.evaluate((img: HTMLImageElement) => img.naturalWidth)).toBe(1);

    // Rangement : la catégorie de test est masquée, son produit disparaît de la boutique.
    await page.goto("/admin/categories");
    await page.getByRole("link", { name: category }).click();
    const save = page.getByRole("button", { name: "Enregistrer" });
    await expect(save).toBeEnabled(); // page hydratée
    await page.getByLabel("Visible sur la boutique").uncheck();
    await save.click();
    await expect(page.getByText("Catégorie enregistrée.")).toBeVisible();
    expect((await page.request.get(`/categories/${await categorySlug(category)}`)).status()).toBe(404);
  });

  test("signale les champs invalides sans perdre la saisie", async ({ page }) => {
    await signUpStaff(page, ["CATALOG_MANAGER"]);
    await page.goto("/admin/produits/nouveau");
    await page.getByLabel("Nom du produit").fill("Produit incomplet");
    await page.getByLabel("Prix de vente TTC (FCFA)").fill("douze");
    await page.getByRole("button", { name: "Créer le produit" }).click();
    await expect(page.locator("form").getByRole("alert")).toHaveText("Vérifiez les champs signalés.");
    await expect(page.getByLabel("Nom du produit")).toHaveValue("Produit incomplet");
    await expect(page.getByLabel("Prix de vente TTC (FCFA)")).toHaveAttribute("aria-invalid", "true");
  });

  test("un gestionnaire de stock ne voit ni la création de produit ni les prix d'achat à l'export", async ({ page }) => {
    await signUpStaff(page, ["STOCK_MANAGER"]);
    await page.goto("/admin/produits");
    await expect(page.getByRole("link", { name: "Nouveau produit" })).toHaveCount(0);
    const response = await page.request.get("/admin/import-export/catalogue.csv");
    expect(response.status()).toBe(200);
    const header = (await response.text()).split("\r\n")[0];
    expect(header).toContain("stock_compte");
    expect(header).not.toContain("prix_achat");
    await page.goto("/admin/produits/nouveau");
    await expect(page).toHaveURL(/\/acces-refuse$/);
  });
});
