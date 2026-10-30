import { expect, test } from "@playwright/test";

test("la sonde de santé répond sans détail interne", async ({ request }) => {
  const response = await request.get("/api/health");
  expect(response.status()).toBe(200);
  expect(await response.json()).toEqual({ status: "ok" });
});

test("l'accueil affiche la boutique et le paiement en espèces uniquement", async ({ page }) => {
  await page.goto("/");
  await expect(page.getByRole("heading", { level: 1 })).toHaveText("FUTANI SHOP");
  await expect(page.getByText("La boutique officielle de FUTANI GROUP.").first()).toBeVisible();
  await expect(page.getByText("Paiement exclusivement en espèces")).toBeVisible();
  await expect(page.getByRole("heading", { name: "Nos univers" })).toBeVisible();
});

test("une page inconnue renvoie une 404", async ({ page }) => {
  const response = await page.goto("/page-qui-n-existe-pas");
  expect(response?.status()).toBe(404);
});
