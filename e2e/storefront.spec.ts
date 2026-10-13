import { expect, test } from "@playwright/test";

const LAPTOP = "/produits/demo-ordinateur-portable-15-pouces-pro";

test.describe("boutique publique", () => {
  test("de l'accueil à une fiche produit, via une catégorie", async ({ page }) => {
    await page.goto("/");
    await expect(page.getByRole("heading", { name: "Nos univers" })).toBeVisible();
    await page.getByRole("main").getByRole("link", { name: "Informatique", exact: true }).click();
    await expect(page).toHaveURL(/\/categories\/informatique$/);
    await expect(page.getByRole("heading", { level: 1, name: "Informatique" })).toBeVisible();
    await expect(page.getByRole("status").filter({ hasText: "produits" })).toHaveText("4 produits");

    await page.getByRole("link", { name: "[DÉMO] Ordinateur portable 15 pouces Pro" }).click();
    await expect(page).toHaveURL(new RegExp(`${LAPTOP}$`));
    await expect(page.getByRole("heading", { level: 1 })).toHaveText("[DÉMO] Ordinateur portable 15 pouces Pro");
    await expect(page.getByText("Versions disponibles")).toBeVisible();
    await expect(page.getByText("Paiement en espèces uniquement, à la livraison ou au retrait.")).toBeVisible();
  });

  test("la fiche produit n'expose ni prix d'achat ni avis inventé, et publie des données structurées", async ({ page }) => {
    const response = await page.goto(LAPTOP);
    const html = (await response?.text()) ?? "";
    expect(html).not.toMatch(/costPrice|300[\s  ]?000|aggregateRating|"review"/);

    const jsonLd = await page.locator('script[type="application/ld+json"]').allTextContents();
    const product = jsonLd.map((text) => JSON.parse(text)).find((data) => data["@type"] === "Product");
    expect(product.offers).toMatchObject({ priceCurrency: "XOF", lowPrice: 385_000, highPrice: 465_000 });
    expect(jsonLd.some((text) => text.includes("BreadcrumbList"))).toBe(true);
  });

  test("recherche depuis l'en-tête, sans tenir compte des accents", async ({ page }) => {
    await page.goto("/");
    await page.getByRole("searchbox", { name: "Rechercher un produit" }).fill("camera");
    await page.getByRole("button", { name: "Lancer la recherche" }).click();
    await expect(page).toHaveURL(/\/recherche\?q=camera/);
    await expect(page.getByRole("link", { name: "[DÉMO] Caméra IP extérieure 4 MP" })).toBeVisible();
  });

  test("filtre les produits disponibles et trie par prix", async ({ page }) => {
    await page.goto("/categories/informatique");
    await page.getByLabel("Disponibles uniquement").check();
    await page.getByLabel("Trier par").selectOption("prix-croissant");
    await page.getByRole("button", { name: "Appliquer" }).click();
    await expect(page).toHaveURL(/tri=prix-croissant/);
    await expect(page).toHaveURL(/dispo=1/);
    await expect(page.getByRole("status").filter({ hasText: "produits" })).toHaveText("3 produits");
    await expect(page.getByRole("link", { name: "[DÉMO] Écran 24 pouces IPS" })).toHaveCount(0);
  });

  test("un brouillon ou un produit inconnu renvoie une 404", async ({ page }) => {
    expect((await page.goto("/produits/demo-tablette-10-pouces-brouillon"))?.status()).toBe(404);
    expect((await page.goto("/categories/inexistante"))?.status()).toBe(404);
  });

  test("une prestation propose devis, réservation et contact", async ({ page }) => {
    await page.goto("/services");
    await expect(page.getByRole("heading", { name: "Vidéosurveillance", level: 2 })).toBeVisible();
    await page.getByRole("link", { name: /Installation de caméras/ }).click();
    await expect(page).toHaveURL(/\/services\/installation-de-cameras$/);
    await expect(page.locator("header").getByText("Sur devis", { exact: true })).toBeVisible();
    await expect(page.getByRole("link", { name: "Réserver une intervention" })).toBeVisible();
    await page.getByRole("link", { name: "Demander un devis" }).click();
    await expect(page.locator("main").getByRole("status")).toContainText("Installation de caméras");
  });

  test("sitemap et robots ne publient que le contenu public", async ({ request }) => {
    const sitemap = await (await request.get("/sitemap.xml")).text();
    expect(sitemap).toContain("/produits/demo-routeur-wi-fi-6-double-bande");
    expect(sitemap).toContain("/categories/informatique");
    expect(sitemap).not.toContain("brouillon");
    expect(sitemap).not.toContain("/admin");
    // Hors production, rien n'est indexé.
    expect(await (await request.get("/robots.txt")).text()).toMatch(/^Disallow: \/$/m);
  });
});

test.describe("affichage responsive (§20 n° 27)", () => {
  for (const path of ["/", "/categories/informatique", LAPTOP, "/recherche?q=routeur", "/services", "/contact", "/connexion"]) {
    test(`${path} ne déborde pas horizontalement`, async ({ page }) => {
      await page.goto(path);
      const overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
      expect(overflow).toBeLessThanOrEqual(0);
    });
  }
});
