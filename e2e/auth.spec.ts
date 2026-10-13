import { expect, test, type Page } from "@playwright/test";
import { grantRole } from "./support/db";

const PASSWORD = "motdepasse-e2e-solide";
const uniqueEmail = () => `e2e-${Date.now()}-${Math.random().toString(36).slice(2, 8)}@example.sn`;

async function signUp(page: Page, email: string): Promise<void> {
  await page.goto("/inscription");
  await page.getByLabel("Nom complet").fill("Client E2E");
  await page.getByLabel("E-mail").fill(email);
  await page.getByLabel("Mot de passe").fill(PASSWORD);
  await page.getByRole("button", { name: "Créer mon compte" }).click();
  await expect(page).toHaveURL(/\/compte$/);
}

test.describe("routes privées (§20 n° 2)", () => {
  for (const path of ["/compte", "/admin"]) {
    test(`${path} redirige un visiteur anonyme vers la connexion`, async ({ page }) => {
      await page.goto(path);
      await expect(page).toHaveURL(new RegExp(`/connexion\\?suivant=${encodeURIComponent(path)}`));
      await expect(page.getByRole("heading", { name: "Connexion" })).toBeVisible();
    });
  }

  test("un cookie de session forgé est rejeté côté serveur", async ({ page, context, baseURL }) => {
    await context.addCookies([{ name: "better-auth.session_token", value: "forge.signature", url: baseURL! }]);
    await page.goto("/compte");
    await expect(page).toHaveURL(/\/connexion\?suivant=%2Fcompte/);
  });

  test("un membre du personnel accède à l'administration selon son rôle", async ({ page }) => {
    const email = uniqueEmail();
    await signUp(page, email);
    await grantRole(email, "CATALOG_MANAGER");

    await page.goto("/admin");
    await expect(page.getByRole("heading", { name: "Administration" })).toBeVisible();
    await expect(page.getByText("Gestionnaire de catalogue")).toBeVisible();
    await expect(page.getByText("products.create")).toBeVisible();
    await expect(page.getByText("payments.record")).toHaveCount(0);
  });

  test("un client connecté ne peut pas ouvrir l'administration", async ({ page }) => {
    await signUp(page, uniqueEmail());
    await page.goto("/admin");
    await expect(page).toHaveURL(/\/acces-refuse$/);
    await expect(page.getByRole("heading", { name: "Accès refusé" })).toBeVisible();
  });
});

test.describe("compte client (§20 n° 1)", () => {
  test("inscription, déconnexion puis reconnexion", async ({ page }) => {
    const email = uniqueEmail();
    await signUp(page, email);
    await expect(page.getByText(email)).toBeVisible();

    await page.getByRole("button", { name: "Se déconnecter" }).click();
    await expect(page).toHaveURL(/\/$/);
    await page.goto("/compte");
    await expect(page).toHaveURL(/\/connexion/);

    await page.getByLabel("E-mail").fill(email);
    await page.getByLabel("Mot de passe").fill(PASSWORD);
    await page.getByRole("button", { name: "Se connecter" }).click();
    await expect(page).toHaveURL(/\/compte$/);
  });

  test("affiche une erreur neutre pour un mauvais mot de passe", async ({ page }) => {
    const email = uniqueEmail();
    await signUp(page, email);
    await page.getByRole("button", { name: "Se déconnecter" }).click();

    await page.goto("/connexion");
    await page.getByLabel("E-mail").fill(email);
    await page.getByLabel("Mot de passe").fill("pas-le-bon-mot-de-passe");
    await page.getByRole("button", { name: "Se connecter" }).click();
    // Le formulaire porte sa propre alerte (Next ajoute aussi un annonceur de route role="alert").
    await expect(page.locator("form").getByRole("alert")).toHaveText("E-mail ou mot de passe incorrect.");
  });

  test("signale les champs invalides à l'inscription", async ({ page }) => {
    await page.goto("/inscription");
    await page.getByLabel("Nom complet").fill("Client E2E");
    await page.getByLabel("E-mail").fill(uniqueEmail());
    await page.getByLabel("Mot de passe").fill("court");
    await page.getByRole("button", { name: "Créer mon compte" }).click();
    await expect(page.getByText("Le mot de passe doit contenir au moins 10 caractères")).toBeVisible();
  });
});

test("les pages portent une CSP avec nonce", async ({ page }) => {
  const response = await page.goto("/");
  const csp = response?.headers()["content-security-policy"] ?? "";
  expect(csp).toMatch(/script-src 'self' 'nonce-[^']+' 'strict-dynamic'/);
  expect(csp).toContain("frame-ancestors 'none'");
});
