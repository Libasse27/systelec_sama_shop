import { expect, test, type Page } from "@playwright/test";

/**
 * Menu « Catalogue » du navbar : s'ouvre au survol de la souris, reste un <details> natif
 * (clavier, tactile et absence de JavaScript inchangés).
 */

/** Délai de fermeture après la sortie de la souris (≈ 150 ms côté composant) : marge large pour l'attente. */
const CLOSE_WAIT_MS = 1_500;

function parts(page: Page) {
  const banner = page.getByRole("banner");
  const details = banner.locator("details").filter({ hasText: "Catalogue" });
  const summary = details.locator("summary");
  const allProducts = details.getByRole("link", { name: "Tous les produits", exact: true });
  return { banner, summary, details, allProducts };
}

test.describe("menu Catalogue : souris (bureau)", () => {
  test.beforeEach(({}, testInfo) => {
    test.skip(testInfo.project.name !== "desktop", "Profil bureau uniquement.");
  });

  test("le survol ouvre le menu sans clic", async ({ page }, testInfo) => {
    await page.setViewportSize({ width: 1280, height: 800 });
    await page.goto("/");
    const { summary, details, allProducts } = parts(page);
    await expect(allProducts).toBeHidden();
    await summary.hover();
    await expect(details).toHaveJSProperty("open", true);
    await expect(allProducts).toBeVisible();
    await page.screenshot({ path: testInfo.outputPath("menu-survol-1280.png") });
  });

  test("passer de Catalogue au menu puis sur une famille le garde ouvert (espace de 4 px franchi)", async ({ page }) => {
    await page.setViewportSize({ width: 1280, height: 800 });
    await page.goto("/");
    const { summary, details, allProducts } = parts(page);
    await summary.hover();
    await expect(allProducts).toBeVisible();
    const sBox = (await summary.boundingBox())!;
    const first = details.locator("ul a").first();
    const fBox = (await first.boundingBox())!;
    // Trajet en petits pas, à travers l'espace entre le summary et la liste.
    await page.mouse.move(sBox.x + sBox.width / 2, sBox.y + sBox.height / 2);
    await page.mouse.move(fBox.x + fBox.width / 2, fBox.y + fBox.height / 2, { steps: 25 });
    await page.waitForTimeout(CLOSE_WAIT_MS);
    await expect(details).toHaveJSProperty("open", true);
    await expect(allProducts).toBeVisible();
  });

  test("quitter la zone ferme le menu après le court délai", async ({ page }) => {
    await page.setViewportSize({ width: 1280, height: 800 });
    await page.goto("/");
    const { summary, details, allProducts } = parts(page);
    await summary.hover();
    await expect(allProducts).toBeVisible();
    await page.mouse.move(640, 600);
    await expect(details).toHaveJSProperty("open", false, { timeout: CLOSE_WAIT_MS });
    await expect(allProducts).toBeHidden();
  });

  test("un clic sur Catalogue pendant le survol ne referme pas le menu", async ({ page }) => {
    await page.setViewportSize({ width: 1280, height: 800 });
    await page.goto("/");
    const { summary, details, allProducts } = parts(page);
    await summary.hover();
    await expect(allProducts).toBeVisible();
    await summary.click();
    await page.waitForTimeout(300);
    await expect(details).toHaveJSProperty("open", true);
    await expect(allProducts).toBeVisible();
  });

  test("un clic sur une famille navigue vers sa page et le menu est fermé après navigation", async ({ page }) => {
    await page.setViewportSize({ width: 1280, height: 800 });
    await page.goto("/");
    const { summary, details } = parts(page);
    await summary.hover();
    const family = details.locator('ul a[href^="/categories/"]').first();
    await expect(family).toBeVisible();
    const href = await family.getAttribute("href");
    await family.click();
    await expect(page).toHaveURL(new RegExp(`${href}$`));
    // Souris immobile, encore à l'emplacement du lien : seul le clic sur le lien peut avoir fermé le menu.
    await expect(details).toHaveJSProperty("open", false);
  });
});

test.describe("logo du navbar : préchargement", () => {
  // Sens mobile seulement : sur grand écran, le logo complet masqué partage son fichier avec le pied de page.
  test("mobile : l'emblème et le texte du grand écran ne sont pas téléchargés", async ({ page }, testInfo) => {
    test.skip(testInfo.project.name !== "mobile", "Profil mobile uniquement.");
    await page.goto("/");
    const link = page.getByRole("banner").getByRole("link", { name: "FUTANI SHOP, accueil", exact: true });
    const visible = link.locator("img:visible");
    await expect(visible).toHaveJSProperty("complete", true);
    expect(await visible.evaluate((img: HTMLImageElement) => img.naturalWidth)).toBeGreaterThan(0);
    const desktopParts = link.locator('img[src*="embleme"], img[src*="texte"]');
    await expect(desktopParts).toHaveCount(2);
    for (const image of await desktopParts.all()) {
      expect(await image.evaluate((img: HTMLImageElement) => img.naturalWidth)).toBe(0);
    }
  });
});

test.describe("menu Catalogue : clavier", () => {
  test("le simple focus n'ouvre pas, Entrée ouvre, Escape ferme et rend le focus au summary", async ({ page }, testInfo) => {
    test.skip(testInfo.project.name !== "desktop", "Profil bureau uniquement.");
    await page.goto("/");
    const { summary, details, allProducts } = parts(page);
    await summary.focus();
    await expect(summary).toBeFocused();
    await expect(details).toHaveJSProperty("open", false);
    await page.keyboard.press("Enter");
    await expect(details).toHaveJSProperty("open", true);
    await expect(allProducts).toBeVisible();
    // Le focus est dans le menu : Escape le ferme et ramène le focus sur le summary.
    await allProducts.focus();
    await page.keyboard.press("Escape");
    await expect(details).toHaveJSProperty("open", false);
    await expect(summary).toBeFocused();
  });

  test("menu ouvert au clavier : un passage de souris ne le ferme pas et le focus reste dans le menu", async ({ page }, testInfo) => {
    test.skip(testInfo.project.name !== "desktop", "Profil bureau uniquement.");
    await page.setViewportSize({ width: 1280, height: 800 });
    await page.goto("/");
    const { summary, details, allProducts } = parts(page);
    await summary.focus();
    await page.keyboard.press("Enter");
    await expect(allProducts).toBeVisible();
    await page.keyboard.press("Tab");
    await expect(details.locator("ul a").first()).toBeFocused();
    await summary.hover();
    await page.mouse.move(640, 700);
    await page.waitForTimeout(CLOSE_WAIT_MS);
    await expect(details).toHaveJSProperty("open", true);
    await expect(details.locator("ul a").first()).toBeFocused();
  });

  test("focus clavier sur Catalogue : un menu ouvert par survol se ferme quand la souris sort", async ({ page }, testInfo) => {
    test.skip(testInfo.project.name !== "desktop", "Profil bureau uniquement.");
    await page.setViewportSize({ width: 1280, height: 800 });
    await page.goto("/");
    const { summary, details } = parts(page);
    await page.mouse.move(640, 700);
    // Focus clavier réel (Tab) jusqu'au summary : c'est lui qui rend :focus-visible vrai.
    for (let presses = 0; presses < 15; presses += 1) {
      await page.keyboard.press("Tab");
      if (await summary.evaluate((el) => el === document.activeElement)) break;
    }
    await expect(summary).toBeFocused();
    await summary.hover();
    await expect(details).toHaveJSProperty("open", true);
    await page.mouse.move(640, 700);
    await expect(details).toHaveJSProperty("open", false, { timeout: CLOSE_WAIT_MS });
  });

  test("tabuler hors du menu le ferme", async ({ page }, testInfo) => {
    test.skip(testInfo.project.name !== "desktop", "Profil bureau uniquement.");
    await page.goto("/");
    const { summary, details, allProducts } = parts(page);
    await summary.focus();
    await page.keyboard.press("Enter");
    await expect(allProducts).toBeVisible();
    await allProducts.focus();
    await page.keyboard.press("Tab");
    await expect(details).toHaveJSProperty("open", false);
    await expect(page.getByRole("banner").getByRole("link", { name: "Services", exact: true })).toBeFocused();
  });

  test("cliquer à l'extérieur ferme un menu ouvert", async ({ page }, testInfo) => {
    test.skip(testInfo.project.name !== "desktop", "Profil bureau uniquement.");
    await page.setViewportSize({ width: 1280, height: 800 });
    await page.goto("/");
    const { summary, details } = parts(page);
    await summary.focus();
    await page.keyboard.press("Enter");
    await expect(details).toHaveJSProperty("open", true);
    await page.mouse.click(640, 700);
    await expect(details).toHaveJSProperty("open", false);
  });
});

test.describe("menu Catalogue : tactile (mobile)", () => {
  test("un appui l'ouvre, un second appui le ferme", async ({ page }, testInfo) => {
    test.skip(testInfo.project.name !== "mobile", "Profil mobile uniquement.");
    await page.goto("/");
    const { summary, details, allProducts } = parts(page);
    await summary.tap();
    await expect(details).toHaveJSProperty("open", true);
    await expect(allProducts).toBeVisible();
    // Laisse passer un éventuel délai de fermeture programmé par un survol parasite.
    await page.waitForTimeout(500);
    await expect(details).toHaveJSProperty("open", true);
    await summary.tap();
    await expect(details).toHaveJSProperty("open", false);
  });
});

test.describe("menu Catalogue : structure et accessibilité", () => {
  test("le summary reste natif, le menu reste un <details>, sans animation ajoutée", async ({ page }) => {
    await page.emulateMedia({ reducedMotion: "reduce" });
    await page.goto("/");
    const { summary, details } = parts(page);
    await expect(details).toHaveCount(1);
    expect(await details.evaluate((el) => el.tagName)).toBe("DETAILS");
    expect(await summary.evaluate((el) => el.tagName)).toBe("SUMMARY");
    expect(await summary.evaluate((el) => el.hasAttribute("role") || el.hasAttribute("tabindex"))).toBe(false);
    // Aucune animation CSS sur le menu ni sur son bouton (seule la rotation du chevron par transition existait déjà).
    const animations = await details.evaluate((el) => getComputedStyle(el).animationName + "|" + getComputedStyle(el.querySelector("ul")!).animationName);
    expect(animations).toBe("none|none");
    expect(await details.evaluate((el) => el.getAnimations({ subtree: true }).length)).toBe(0);
  });
});
