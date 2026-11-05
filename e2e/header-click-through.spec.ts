import { expect, test, type Locator, type Page } from "@playwright/test";
import { guardCompanySetting, writeCompanySetting, type CompanySettingGuard } from "./support/db";

/**
 * Emblème du navbar : la partie qui dépasse sous le navbar laisse passer les clics vers le contenu,
 * alors que toute sa partie située dans le navbar reste le lien d'accueil.
 * Clics réels à la souris, aux coordonnées de l'emblème, y compris sur ses zones transparentes.
 * Le paramètre « company » est partagé : verrou commun et aucun logo téléversé, sinon l'emblème n'existe pas.
 */
const LOGO_NAME = "FUTANI SHOP, accueil";
const DESKTOP_WIDTHS = [1024, 1280];
/** Haut de la cible après défilement, dans la fenêtre : juste sous le navbar de 74 px, donc sous l'emblème. */
const TARGET_TOP_UNDER_OVERHANG = 80;

interface Box {
  x: number;
  y: number;
  width: number;
  height: number;
}

const emblemOf = (page: Page): Locator => page.getByRole("banner").locator('img[src*="embleme"]');
const serviceCards = (page: Page): Locator => page.locator('main ul a[href^="/services/"]');

async function boxOf(locator: Locator): Promise<Box> {
  const box = await locator.boundingBox();
  if (!box) throw new Error("Élément sans boîte : absent ou masqué.");
  return box;
}

/** Fait défiler la page pour placer le haut de la cible juste sous le navbar. */
async function scrollUnderOverhang(target: Locator): Promise<void> {
  await target.evaluate((el, top) => window.scrollBy(0, el.getBoundingClientRect().top - top), TARGET_TOP_UNDER_OVERHANG);
}

/** Vérifie que le point est bien dans la partie de l'emblème qui dépasse, puis y clique. */
async function clickInOverhang(page: Page, x: number, y: number): Promise<void> {
  const banner = await boxOf(page.getByRole("banner"));
  const emblem = await boxOf(emblemOf(page));
  expect(x).toBeGreaterThanOrEqual(emblem.x);
  expect(x).toBeLessThanOrEqual(emblem.x + emblem.width);
  expect(y).toBeGreaterThan(banner.y + banner.height);
  expect(y).toBeLessThan(emblem.y + emblem.height);
  await page.mouse.click(x, y);
}

test.describe("emblème du navbar : zone cliquable", () => {
  let guard: CompanySettingGuard | undefined;

  test.beforeEach(async ({}, testInfo) => {
    // Profil décidé avant le verrou : un test ignoré ne doit ni le prendre ni faire attendre les autres fichiers.
    const expectedProject = testInfo.title.startsWith("mobile") ? "mobile" : "desktop";
    test.skip(testInfo.project.name !== expectedProject, `Profil ${expectedProject} uniquement.`);
    guard = await guardCompanySetting();
    await writeCompanySetting(null);
  });

  test.afterEach(async () => {
    const current = guard;
    guard = undefined;
    await current?.restore();
  });

  for (const width of DESKTOP_WIDTHS) {
    test(`bureau ${width} px : un clic sous le centre de l'emblème ouvre la carte située dessous`, async ({ page }) => {
      await page.setViewportSize({ width, height: 800 });
      await page.goto("/services");
      const card = serviceCards(page).first();
      const href = await card.getAttribute("href");
      await scrollUnderOverhang(card);
      const emblem = await boxOf(emblemOf(page));
      await clickInOverhang(page, emblem.x + emblem.width / 2, emblem.y + emblem.height - 14);
      await expect(page).toHaveURL(new RegExp(`${href}$`));
    });

    test(`bureau ${width} px : un clic sur un coin transparent de l'emblème ouvre la carte située dessous`, async ({ page }) => {
      await page.setViewportSize({ width, height: 800 });
      await page.goto("/services");
      const card = serviceCards(page).first();
      const href = await card.getAttribute("href");
      await scrollUnderOverhang(card);
      const emblem = await boxOf(emblemOf(page));
      await clickInOverhang(page, emblem.x + emblem.width - 3, emblem.y + emblem.height - 3);
      await expect(page).toHaveURL(new RegExp(`${href}$`));
    });

    test(`bureau ${width} px : un petit lien du fil d'Ariane sous l'emblème reste cliquable`, async ({ page }) => {
      await page.setViewportSize({ width, height: 800 });
      await page.goto("/services");
      // Ce lien mène aussi à l'accueil : l'URL ne les distingue pas, on vérifie donc quel lien reçoit le clic.
      const crumb = page.locator("main").getByRole("link", { name: "Accueil", exact: true });
      await scrollUnderOverhang(crumb);
      const box = await boxOf(crumb);
      const point = { x: box.x + box.width / 2, y: box.y + box.height / 2 };
      const reachesCrumb = await crumb.evaluate((el, { x, y }) => el.contains(document.elementFromPoint(x, y)), point);
      expect(reachesCrumb).toBe(true);
      await clickInOverhang(page, point.x, point.y);
      await expect(page).toHaveURL(/\/$/);
    });

    test(`bureau ${width} px : toute la partie de l'emblème située dans le navbar mène à l'accueil`, async ({ page }) => {
      await page.setViewportSize({ width, height: 800 });
      await page.goto("/services");
      const link = page.getByRole("banner").getByRole("link", { name: LOGO_NAME, exact: true });
      const banner = await boxOf(page.getByRole("banner"));
      const emblem = await boxOf(emblemOf(page));
      const xs = [emblem.x + 1, emblem.x + emblem.width / 2, emblem.x + emblem.width - 1];
      const ys = [emblem.y + 1, banner.y + banner.height / 2, banner.y + banner.height - 1];
      for (const x of xs) {
        for (const y of ys) {
          const inLink = await link.evaluate((el, point) => el.contains(document.elementFromPoint(point.x, point.y)), { x, y });
          expect(inLink, `point (${x}, ${y})`).toBe(true);
        }
      }
      await page.mouse.click(emblem.x + 1, banner.y + banner.height - 1);
      await expect(page).toHaveURL(/\/$/);
    });

    test(`bureau ${width} px : le menu Catalogue reste utilisable une fois la page défilée`, async ({ page }) => {
      await page.setViewportSize({ width, height: 800 });
      await page.goto("/services");
      await scrollUnderOverhang(serviceCards(page).first());
      const banner = page.getByRole("banner");
      await banner.getByText("Catalogue", { exact: true }).click();
      await banner.locator("details[open] > ul").getByRole("link", { name: "Tous les produits", exact: true }).click();
      await expect(page).toHaveURL(/\/recherche/);
    });
  }

  test("bureau 1280 px, clavier : Entrée sur le lien d'accueil ramène à l'accueil", async ({ page }) => {
    await page.setViewportSize({ width: 1280, height: 800 });
    await page.goto("/services");
    const link = page.getByRole("banner").getByRole("link", { name: LOGO_NAME, exact: true });
    await link.focus();
    await expect(link).toBeFocused();
    await page.keyboard.press("Enter");
    await expect(page).toHaveURL(/\/$/);
  });

  test("bureau 1280 px, clavier : en remontant avec Maj+Tab, la carte focalisée n'est pas sous l'emblème", async ({ page }) => {
    await page.setViewportSize({ width: 1280, height: 800 });
    await page.goto("/services");
    const cards = serviceCards(page);
    // Deuxième ligne de la grille (3 colonnes) placée sous l'emblème ; le focus part de la ligne suivante, déjà visible.
    await scrollUnderOverhang(cards.nth(3));
    await cards.nth(6).focus();
    for (let step = 0; step < 3; step += 1) await page.keyboard.press("Shift+Tab");
    await expect(cards.nth(3)).toBeFocused();
    const emblem = await boxOf(emblemOf(page));
    await expect.poll(async () => (await boxOf(cards.nth(3))).y).toBeGreaterThanOrEqual(emblem.y + emblem.height);
  });

  test("mobile : un appui sur le logo ramène à l'accueil", async ({ page }) => {
    await page.goto("/services");
    await page.getByRole("banner").getByRole("link", { name: LOGO_NAME, exact: true }).tap();
    await expect(page).toHaveURL(/\/$/);
  });

  test("mobile : un appui sur une carte ouvre le service, l'emblème du grand écran étant masqué", async ({ page }) => {
    await page.goto("/services");
    await expect(emblemOf(page)).toBeHidden();
    const card = serviceCards(page).first();
    const href = await card.getAttribute("href");
    await card.tap();
    await expect(page).toHaveURL(new RegExp(`${href}$`));
  });
});
