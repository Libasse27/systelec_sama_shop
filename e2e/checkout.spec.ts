import { expect, test, type Page } from "@playwright/test";
import { createTestProduct, grantRole, hideTestCategory, stockOf } from "./support/db";

const PASSWORD = "motdepasse-e2e-solide";
const uniqueEmail = () => `e2e-cmd-${Date.now()}-${Math.random().toString(36).slice(2, 8)}@example.sn`;

async function signUp(page: Page, email: string, name = "Client E2E"): Promise<void> {
  await page.goto("/inscription");
  await page.getByLabel("Nom complet").fill(name);
  await page.getByLabel("E-mail").fill(email);
  await page.getByLabel("Mot de passe").fill(PASSWORD);
  await page.getByRole("button", { name: "Créer mon compte" }).click();
  await expect(page).toHaveURL(/\/compte$/);
}

async function addToCart(page: Page, slug: string, quantity: number): Promise<void> {
  await page.goto(`/produits/${slug}`);
  const add = page.getByRole("button", { name: "Ajouter au panier" });
  await expect(add).toBeEnabled(); // page hydratée
  await page.getByLabel("Quantité").fill(String(quantity));
  await add.click();
  await expect(page.getByText(/Ajouté au panier/)).toBeVisible();
}

test.describe("panier et commande (§20 n° 7 à 14)", () => {
  const categories: string[] = [];
  test.afterAll(async () => {
    for (const id of categories) await hideTestCategory(id);
  });

  test("un invité commande en livraison : total serveur, stock réservé, lien de suivi, confirmation par le personnel", async ({ page, browser }) => {
    const product = await createTestProduct({ price: 12_500, onHand: 3 });
    categories.push(product.categoryId);

    await addToCart(page, product.slug, 2);
    await expect(page.getByRole("link", { name: /Panier\s*2/ })).toBeVisible();
    await page.getByRole("link", { name: /Panier/ }).click();
    await page.getByRole("link", { name: "Passer la commande" }).click();
    await expect(page).toHaveURL(/\/commande$/);

    await page.getByLabel("Nom complet").fill("Awa Diop");
    await page.getByLabel("Téléphone").fill("77 123 45 67");
    await page.getByLabel(/Livraison — \[DÉMO\] Zone A/).check();
    await page.getByRole("textbox", { name: "Adresse" }).fill("Rue 10 x Rue 15");
    await page.getByLabel("Quartier").fill("Médina");
    await page.getByRole("button", { name: "Confirmer la commande" }).click();

    await expect(page).toHaveURL(/\/commande\/CMD-\d{4}-\d{6}\?jeton=/);
    await expect(page.getByText("Merci ! Votre commande est enregistrée")).toBeVisible();
    // 2 × 12 500 + 1 500 de livraison (zone A de démonstration) : total recalculé par le serveur.
    await expect(page.getByRole("row", { name: /Total à payer en espèces/ })).toContainText("26");
    const number = (await page.getByRole("heading", { level: 1 }).textContent())!.replace("Commande ", "").trim();
    expect(await stockOf(product.sku)).toEqual({ onHand: 3, reserved: 2 });

    // Le lien sans jeton ne révèle rien.
    expect((await page.request.get(`/commande/${number}`)).status()).toBe(404);

    // Le gestionnaire de commandes la confirme.
    const staff = await browser.newPage();
    const email = uniqueEmail();
    await signUp(staff, email, "Gestionnaire commandes");
    await grantRole(email, "ORDER_MANAGER");
    await staff.goto(`/admin/commandes?q=${number}`);
    await staff.getByRole("link", { name: number }).click();
    const confirm = staff.getByRole("button", { name: "Confirmée" });
    await expect(confirm).toBeEnabled();
    await confirm.click();
    await expect(staff.getByText("Commande passée à « Confirmée ».")).toBeVisible();
    await staff.close();

    await page.reload();
    await expect(page.getByText("Confirmée").first()).toBeVisible();
  });

  test("un client connecté commande en retrait, retrouve et annule sa commande", async ({ page }) => {
    const product = await createTestProduct({ price: 8_000, onHand: 5 });
    categories.push(product.categoryId);
    await signUp(page, uniqueEmail());

    await addToCart(page, product.slug, 1);
    await page.goto("/commande");
    await page.getByLabel("Téléphone").fill("+221 70 000 00 00");
    await page.getByLabel(/Retrait gratuit — \[DÉMO\] Boutique/).check();
    await page.getByRole("button", { name: "Confirmer la commande" }).click();
    await expect(page).toHaveURL(/\/commande\/CMD-\d{4}-\d{6}$/);
    expect(await stockOf(product.sku)).toEqual({ onHand: 5, reserved: 1 });

    await page.goto("/compte");
    await page.getByRole("link", { name: /^CMD-/ }).first().click();
    page.once("dialog", (dialog) => dialog.accept());
    await page.getByRole("button", { name: "Annuler ma commande" }).click();
    await expect(page.getByRole("status")).toContainText("Commande annulée");
    expect(await stockOf(product.sku)).toEqual({ onHand: 5, reserved: 0 });
  });

  test("refuse d'ajouter plus que le stock disponible", async ({ page }) => {
    const product = await createTestProduct({ price: 5_000, onHand: 1 });
    categories.push(product.categoryId);
    await page.goto(`/produits/${product.slug}`);
    await expect(page.getByRole("button", { name: "Ajouter au panier" })).toBeEnabled();
    await page.getByLabel("Quantité").fill("2");
    await page.getByRole("button", { name: "Ajouter au panier" }).click();
    await expect(page.locator("form").getByRole("alert")).toHaveText("Stock disponible : 1 unité(s).");
  });
});
