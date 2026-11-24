import { expect, test, type Page } from "@playwright/test";
import { createTestProduct, grantRole, hideTestCategory } from "./support/db";
import { signUp, uniqueEmail } from "./support/flows";

/** Largeurs de téléphone courantes, dont la plus étroite prise en charge (320 px). */
const PHONE_WIDTHS = [320, 360, 390];
const PHONE_HEIGHT = 740;

/**
 * Dépassement horizontal de la page, en pixels. Comparé à « clientWidth » : sur un profil mobile,
 * « window.innerWidth » s'élargit avec le contenu et masquerait le défaut.
 */
const pageOverflow = (page: Page): Promise<number> =>
  page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);

async function expectNoOverflow(page: Page, paths: readonly string[]): Promise<void> {
  for (const path of paths) {
    const response = await page.goto(path);
    expect(response?.status(), path).toBe(200);
    for (const width of PHONE_WIDTHS) {
      await page.setViewportSize({ width, height: PHONE_HEIGHT });
      expect.soft(await pageOverflow(page), `${path} à ${width} px`).toBeLessThanOrEqual(0);
    }
  }
}

test("boutique : aucune page ne déborde sur téléphone", async ({ page }) => {
  await expectNoOverflow(page, ["/", "/recherche", "/panier", "/services", "/devis/demande", "/contact", "/connexion", "/inscription"]);
});

test("accueil : le nom d'une famille reste dans sa carte sur téléphone", async ({ page }) => {
  await page.goto("/");
  const cards = page.getByRole("region", { name: "Nos univers" }).getByRole("link");
  await expect(cards.first()).toBeVisible();
  for (const width of PHONE_WIDTHS) {
    await page.setViewportSize({ width, height: PHONE_HEIGHT });
    const overflowing = await cards.evaluateAll((links) => links.filter((link) => link.scrollWidth > link.clientWidth).map((link) => link.textContent));
    expect(overflowing, `${width} px`).toEqual([]);
  }
});

test("administration : aucune page ne déborde sur téléphone, même avec des libellés longs", async ({ page }) => {
  test.setTimeout(120_000);
  // Compte de livreur au nom long : option de la liste « Compte du livreur interne » et, une fois enregistré, du filtre « Livreur ».
  const courierEmail = uniqueEmail("e2e-livreur-au-nom-particulierement-long");
  await signUp(page, courierEmail, "Livreur au nom particulièrement long pour vérifier l'affichage");
  await grantRole(courierEmail, "COURIER");
  await page.context().clearCookies();

  const product = await createTestProduct({ price: 10_000, onHand: 0 });
  try {
    const email = uniqueEmail("e2e-responsive");
    await signUp(page, email, "Affichage E2E");
    await grantRole(email, "SUPER_ADMIN");

    const courierName = `Transporteur E2E au nom particulièrement long, agence de Dakar ${Date.now()}`;
    await page.goto("/admin/livraison");
    const couriers = page.getByRole("region", { name: "Livreurs" });
    await couriers.getByLabel("Nom du livreur ou du transporteur").last().fill(courierName);
    await couriers.getByLabel("Téléphone").last().fill("77 000 00 00");
    await couriers.getByLabel("Type").last().selectOption({ label: "Transporteur externe" });
    await couriers.getByRole("button", { name: "Ajouter le livreur" }).click();
    await expect(couriers.getByText(courierName)).toBeVisible();

    await page.goto(`/admin/stock?q=${product.sku}`);
    const stockPath = await page.locator('main a[href^="/admin/stock/e2evar"]').first().getAttribute("href");
    await expectNoOverflow(page, [
      "/",
      "/admin",
      "/admin/categories",
      "/admin/produits",
      "/admin/produits/nouveau",
      "/admin/livraison",
      "/admin/livraisons",
      "/admin/retours",
      "/admin/stock",
      stockPath!,
      "/admin/utilisateurs",
    ]);

    // Aucune commande de l'en-tête hors de l'écran à la plus petite largeur.
    await page.setViewportSize({ width: PHONE_WIDTHS[0]!, height: PHONE_HEIGHT });
    const signOut = await page.getByRole("banner").getByRole("button", { name: "Se déconnecter" }).boundingBox();
    expect(signOut!.x).toBeGreaterThanOrEqual(0);
    expect(signOut!.x + signOut!.width).toBeLessThanOrEqual(PHONE_WIDTHS[0]!);
  } finally {
    await hideTestCategory(product.categoryId);
  }
});
