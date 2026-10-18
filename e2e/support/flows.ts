import { expect, type Page } from "@playwright/test";

export const PASSWORD = "motdepasse-e2e-solide";
export const uniqueEmail = (prefix = "e2e-cmd") => `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}@example.sn`;

export async function signUp(page: Page, email: string, name = "Client E2E"): Promise<void> {
  await page.goto("/inscription");
  await page.getByLabel("Nom complet").fill(name);
  await page.getByLabel("E-mail").fill(email);
  await page.getByLabel("Mot de passe").fill(PASSWORD);
  await page.getByRole("button", { name: "Créer mon compte" }).click();
  await expect(page).toHaveURL(/\/compte$/);
}

export async function addToCart(page: Page, slug: string, quantity: number): Promise<void> {
  await page.goto(`/produits/${slug}`);
  const add = page.getByRole("button", { name: "Ajouter au panier" });
  await expect(add).toBeEnabled(); // page hydratée
  await page.getByLabel("Quantité").fill(String(quantity));
  await add.click();
  await expect(page.getByText(/Ajouté au panier/)).toBeVisible();
}
