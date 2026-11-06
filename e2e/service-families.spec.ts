import { expect, test } from "@playwright/test";

/** Familles publiées par le catalogue de base (src/server/modules/catalog/taxonomy.ts), avec leur nombre de prestations. */
const FAMILIES = [
  { slug: "maintenance-informatique", name: "Maintenance informatique", services: 12 },
  { slug: "reseaux-informatiques", name: "Réseaux informatiques", services: 9 },
  { slug: "videosurveillance", name: "Vidéosurveillance", services: 10 },
  { slug: "electricite", name: "Électricité", services: 10 },
  { slug: "developpement-web", name: "Développement web", services: 1 },
];
const TOTAL_SERVICES = 42;
/** Hauteur minimale d'une icône de famille : ces images détaillées sont illisibles en petit. */
const MIN_FAMILY_ICON_HEIGHT = 80;

const familyPath = (slug: string): string => `/services/categorie/${slug}`;

/** Slugs des fiches de prestation liées dans le HTML rendu par le serveur (sans exécuter de JavaScript). */
function serviceSlugsIn(html: string): Set<string> {
  const main = html.slice(html.indexOf("<main"), html.indexOf("</main>"));
  const matches = main.matchAll(/href="\/services\/(?!categorie\/)([a-z0-9-]+)"/g);
  return new Set([...matches].map((match) => match[1] ?? ""));
}

test.describe("page Services FUTANI TECH", () => {
  test("présente FUTANI TECH et les 5 familles, chacune en lien vers sa page", async ({ page }) => {
    await page.goto("/services");
    await expect(page).toHaveTitle("Services techniques | FUTANI TECH");
    await expect(page.getByRole("heading", { level: 1 })).toContainText("FUTANI TECH");
    const cards = page.getByRole("region", { name: "Familles de services" }).getByRole("link");
    await expect(cards).toHaveCount(FAMILIES.length);
    for (const [index, family] of FAMILIES.entries()) {
      const card = cards.nth(index);
      await expect(card).toHaveAttribute("href", familyPath(family.slug));
      await expect(card.getByRole("heading", { level: 2, name: family.name, exact: true })).toBeVisible();
      await expect(card).toContainText("Découvrir les prestations");
      const icon = card.locator("img");
      await expect(icon).toBeVisible();
      expect(decodeURIComponent((await icon.getAttribute("src")) ?? "")).toContain(`/icones/services/${family.slug}.png`);
      // Image bien chargée (un fichier absent laisserait une largeur naturelle nulle), assez grande pour rester lisible.
      // next/image charge en différé : l'image doit d'abord entrer dans la fenêtre.
      await icon.scrollIntoViewIfNeeded();
      await expect.poll(() => icon.evaluate((image: HTMLImageElement) => image.naturalWidth)).toBeGreaterThan(0);
      expect((await icon.boundingBox())!.height).toBeGreaterThanOrEqual(MIN_FAMILY_ICON_HEIGHT);
    }
  });

  test("conduit au devis général et, par son ancre, aux familles", async ({ page }) => {
    await page.goto("/services");
    const main = page.locator("main");
    await expect(main.getByRole("link", { name: "Demander un devis" }).first()).toHaveAttribute("href", "/devis/demande");
    await expect(main.getByRole("link", { name: "Découvrir nos services" })).toHaveAttribute("href", "#familles");
    await expect(main.getByRole("link", { name: "Nous contacter" })).toHaveAttribute("href", "/contact");
    await main.getByRole("link", { name: "Découvrir nos services" }).click();
    await expect(page).toHaveURL(/#familles$/);
  });
});

test.describe("pages de famille", () => {
  for (const family of FAMILIES) {
    test(`${family.name} : page indexable listant ses ${family.services} prestations`, async ({ page }) => {
      const response = await page.goto(familyPath(family.slug));
      expect(response?.status()).toBe(200);
      await expect(page).toHaveTitle(`${family.name} | FUTANI TECH`);
      await expect(page.getByRole("heading", { level: 1, name: family.name, exact: true })).toBeVisible();
      await expect(page.locator('link[rel="canonical"]')).toHaveAttribute("href", new RegExp(`${familyPath(family.slug)}$`));
      await expect(page.locator('meta[name="description"]')).toHaveAttribute("content", /.+/);
      await expect(page.getByRole("navigation", { name: "Fil d'Ariane" }).getByRole("link", { name: "Services", exact: true })).toHaveAttribute(
        "href",
        "/services",
      );
      await expect(page.locator("main ul > li")).toHaveCount(family.services);
    });
  }

  test("une famille inconnue et l'adresse sans famille renvoient une 404", async ({ page }) => {
    expect((await page.goto(familyPath("inexistante")))?.status()).toBe(404);
    expect((await page.goto("/services/categorie"))?.status()).toBe(404);
  });

  test("le devis direct d'une prestation se préremplit, et sa fiche renvoie à sa famille", async ({ page }) => {
    await page.goto(familyPath("videosurveillance"));
    await page.getByRole("link", { name: "Demander un devis : Installation de caméras", exact: true }).click();
    await expect(page).toHaveURL(/\/devis\/demande\?service=installation-de-cameras$/);
    await expect(page.locator("main")).toContainText("Service : Installation de caméras");

    await page.goto("/services/installation-de-cameras");
    await page.locator("main header").getByRole("link", { name: "Vidéosurveillance", exact: true }).click();
    await expect(page).toHaveURL(new RegExp(`${familyPath("videosurveillance")}$`));
  });
});

test.describe("affichage et clavier", () => {
  const WIDTHS = [320, 390, 820, 1024, 1280, 1920];
  const PATHS = ["/services", familyPath("maintenance-informatique"), familyPath("developpement-web")];

  for (const width of WIDTHS) {
    test(`${width} px : aucun débordement horizontal, et l'emblème ne couvre pas le contenu au repos`, async ({ page }) => {
      await page.setViewportSize({ width, height: 800 });
      for (const path of PATHS) {
        await page.goto(path);
        const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
        expect(overflow, path).toBeLessThanOrEqual(0);

        const emblem = page.getByRole("banner").locator('img[src*="embleme"]');
        if (!(await emblem.isVisible())) continue;
        const emblemBox = await emblem.boundingBox();
        const contentBox = await page.locator("main > *").first().boundingBox();
        expect(contentBox!.y, path).toBeGreaterThanOrEqual(emblemBox!.y + emblemBox!.height);
      }
    });
  }

  test("les cartes et les liens de prestation se parcourent au clavier, avec un focus visible", async ({ page }) => {
    const outlineOfFocused = (): Promise<string> => page.evaluate(() => getComputedStyle(document.activeElement!).outlineStyle);

    await page.goto("/services");
    await page.getByRole("link", { name: "Découvrir nos services" }).focus();
    await page.keyboard.press("Tab");
    await expect(page.getByRole("link", { name: /^Maintenance informatique/ })).toBeFocused();
    expect(await outlineOfFocused()).not.toBe("none");

    await page.goto(familyPath("developpement-web"));
    await page.getByRole("link", { name: /^Développement web fullstack/ }).focus();
    await page.keyboard.press("Tab");
    await expect(page.getByRole("link", { name: "Demander un devis : Développement web fullstack", exact: true })).toBeFocused();
    expect(await outlineOfFocused()).not.toBe("none");
  });
});

test.describe("référencement et absence de JavaScript", () => {
  test("le HTML serveur des pages de famille lie les 42 fiches, qui répondent toutes", async ({ request }) => {
    const slugs = new Set<string>();
    for (const family of FAMILIES) {
      const html = await (await request.get(familyPath(family.slug))).text();
      const inFamily = serviceSlugsIn(html);
      expect(inFamily.size, family.name).toBe(family.services);
      for (const slug of inFamily) slugs.add(slug);
    }
    expect(slugs.size).toBe(TOTAL_SERVICES);
    for (const slug of slugs) expect((await request.get(`/services/${slug}`)).status(), slug).toBe(200);
  });

  test("le sitemap contient /services, les 5 familles et les 42 fiches", async ({ request }) => {
    const sitemap = await (await request.get("/sitemap.xml")).text();
    expect(sitemap).toContain("/services</loc>");
    for (const family of FAMILIES) expect(sitemap).toContain(`${familyPath(family.slug)}</loc>`);
    const serviceEntries = sitemap.match(/\/services\/(?!categorie\/)[a-z0-9-]+<\/loc>/g) ?? [];
    expect(serviceEntries).toHaveLength(TOTAL_SERVICES);
  });

  test.describe("sans JavaScript", () => {
    test.use({ javaScriptEnabled: false });

    test("de /services à la famille, à la fiche, puis au devis prérempli", async ({ page }) => {
      await page.goto("/services");
      await page.getByRole("link", { name: /^Électricité/ }).click();
      await expect(page).toHaveURL(new RegExp(`${familyPath("electricite")}$`));
      await page.getByRole("link", { name: /^Installation électrique/ }).click();
      await expect(page).toHaveURL(/\/services\/installation-electrique$/);
      await page.getByRole("link", { name: "Demander un devis ou une intervention" }).click();
      await expect(page).toHaveURL(/\/devis\/demande\?service=installation-electrique$/);
      await expect(page.locator("main")).toContainText("Service : Installation électrique");
    });
  });
});
