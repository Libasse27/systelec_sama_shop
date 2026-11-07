import { expect, test, type Locator, type Page } from "@playwright/test";

/**
 * Navbar par espace : FUTANI SHOP sur la boutique, FUTANI TECH dans la rubrique Services et les devis
 * (src/lib/routes.ts, isTechPath). Recherche, panier et compte restent communs aux deux espaces.
 */
const SHOP_LOGO = "FUTANI SHOP, accueil";
const TECH_LOGO = "FUTANI TECH, accueil des services";

const banner = (page: Page): Locator => page.getByRole("banner");
const mainNav = (page: Page): Locator => banner(page).getByRole("navigation", { name: "Navigation principale", exact: true });

async function expectShopNavbar(page: Page): Promise<void> {
  await expect(banner(page).getByRole("link", { name: SHOP_LOGO, exact: true })).toHaveAttribute("href", "/");
  await expect(banner(page).getByRole("link", { name: TECH_LOGO, exact: true })).toHaveCount(0);
  await expect(mainNav(page).locator("summary")).toHaveText("Catalogue");
  await expect(mainNav(page).getByRole("link", { name: "Services", exact: true })).toHaveAttribute("href", "/services");
  await expect(mainNav(page).getByRole("link", { name: "Boutique", exact: true })).toHaveCount(0);
}

async function expectTechNavbar(page: Page): Promise<void> {
  await expect(banner(page).getByRole("link", { name: TECH_LOGO, exact: true })).toHaveAttribute("href", "/services");
  await expect(banner(page).getByRole("link", { name: SHOP_LOGO, exact: true })).toHaveCount(0);
  await expect(mainNav(page).locator("summary")).toHaveText("Services");
  await expect(mainNav(page).getByRole("link", { name: "Demander un devis", exact: true })).toHaveAttribute("href", "/devis/demande");
  await expect(mainNav(page).getByRole("link", { name: "Contact", exact: true })).toHaveAttribute("href", "/contact");
  await expect(mainNav(page).getByRole("link", { name: "Boutique", exact: true })).toHaveAttribute("href", "/");
}

test.describe("navbar par espace", () => {
  for (const path of ["/", "/recherche", "/contact", "/panier"]) {
    test(`${path} : navbar FUTANI SHOP`, async ({ page }) => {
      await page.goto(path);
      await expectShopNavbar(page);
    });
  }

  for (const path of ["/services", "/services/categorie/electricite", "/services/installation-de-cameras", "/devis/demande"]) {
    test(`${path} : navbar FUTANI TECH avec retour à la boutique`, async ({ page }) => {
      await page.goto(path);
      await expectTechNavbar(page);
    });
  }

  test("le menu Services de FUTANI TECH liste les familles et mène à toutes les prestations", async ({ page }) => {
    await page.goto("/services/categorie/electricite");
    const details = mainNav(page).locator("details");
    await details.locator("summary").click();
    await expect(details.getByRole("link", { name: "Électricité", exact: true })).toHaveAttribute("href", "/services/categorie/electricite");
    await details.getByRole("link", { name: "Tous les services", exact: true }).click();
    await expect(page).toHaveURL(/\/services$/);
  });

  test("navigation interne boutique → services → boutique : le navbar bascule sans rechargement", async ({ page }) => {
    await page.goto("/");
    // Repère posé dans la page : il disparaîtrait avec un rechargement complet.
    await page.evaluate(() => Object.assign(window, { __sansRechargement: true }));
    await mainNav(page).getByRole("link", { name: "Services", exact: true }).click();
    await expect(page).toHaveURL(/\/services$/);
    await expectTechNavbar(page);
    await mainNav(page).getByRole("link", { name: "Boutique", exact: true }).click();
    await expect(page).toHaveURL(/\/$/);
    await expectShopNavbar(page);
    expect(await page.evaluate(() => (window as unknown as { __sansRechargement?: boolean }).__sansRechargement)).toBe(true);
  });

  test("mobile 390 px : la navigation FUTANI TECH tient dans la largeur, sans défilement horizontal", async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 800 });
    await page.goto("/services");
    const boutique = mainNav(page).getByRole("link", { name: "Boutique", exact: true });
    await expect(boutique).toBeVisible();
    const box = (await boutique.boundingBox())!;
    expect(box.x + box.width).toBeLessThanOrEqual(390);
    expect(await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth)).toBeLessThanOrEqual(0);
  });
});
