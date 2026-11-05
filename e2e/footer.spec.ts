import { expect, test, type Locator, type Page } from "@playwright/test";
import { copyFile, mkdir, rm } from "node:fs/promises";
import { guardCompanySetting, grantRole, writeCompanySetting, type CompanySettingGuard } from "./support/db";
import { signUp, uniqueEmail } from "./support/flows";

/**
 * Mention de copyright du pied de page : nom du groupe, jamais l'ancien nom de la société.
 */
test("pied de page : copyright au nom de FUTANI GROUP", async ({ page }) => {
  await page.goto("/");
  const footer = page.getByRole("contentinfo");
  await expect(footer.getByText(`© ${new Date().getFullYear()} FUTANI GROUP. Tous droits réservés.`, { exact: true })).toBeVisible();
});

test("pied de page : bloc Paiement avec les trois moyens acceptés, sans repère de navigation", async ({ page }) => {
  await page.goto("/");
  const footer = page.getByRole("contentinfo");
  await expect(footer.getByRole("heading", { level: 2, name: "Paiement", exact: true })).toBeVisible();
  await expect(footer.getByRole("navigation", { name: "Paiement" })).toHaveCount(0);
  for (const label of ["Espèces", "Orange Money", "Wave"]) {
    await expect(footer.getByRole("listitem").filter({ hasText: label })).toBeVisible();
  }
  await expect(footer.getByText("À la livraison ou au retrait.", { exact: true })).toBeVisible();
});

/**
 * Fond du navbar et du pied de page : blanc, pour que les logos et les icônes gardent leurs couleurs.
 * Lecture seule, sans toucher au paramètre « company » : valable sur les deux profils.
 */
test("navbar et pied de page : fond blanc, distinct du fond de la page", async ({ page }, testInfo) => {
  await page.goto("/");
  const expected = "rgb(255, 255, 255)";
  await expect(page.getByRole("banner")).toHaveCSS("background-color", expected);
  await expect(page.getByRole("contentinfo")).toHaveCSS("background-color", expected);
  // Séparation avec la page (#f3f5f8) : ombre sous le navbar, filet en haut du pied de page.
  await expect(page.locator("body")).toHaveCSS("background-color", "rgb(243, 245, 248)");
  expect(await page.getByRole("banner").evaluate((el) => getComputedStyle(el).boxShadow)).not.toBe("none");
  const footerBorder = await page.getByRole("contentinfo").evaluate((el) => {
    const style = getComputedStyle(el);
    return { width: style.borderTopWidth, style: style.borderTopStyle, color: style.borderTopColor };
  });
  expect(footerBorder.width).toBe("1px");
  expect(footerBorder.style).toBe("solid");
  expect(footerBorder.color).not.toBe("rgba(0, 0, 0, 0)");
  await page.screenshot({ path: testInfo.outputPath(`accueil-${testInfo.project.name}.png`), fullPage: true });
});

/** Contraste WCAG d'une couleur CSS quelconque (opacité incluse) composée sur du blanc, mesuré dans la page. */
async function contrastsOnWhite(page: Page, selector: string): Promise<{ text: string; ratio: number }[]> {
  return page.evaluate((query) => {
    const context = document.createElement("canvas").getContext("2d", { willReadFrequently: true })!;
    const channel = (value: number) => {
      const v = value / 255;
      return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4;
    };
    const luminance = (color: string) => {
      context.fillStyle = "#fff";
      context.fillRect(0, 0, 1, 1);
      context.fillStyle = color;
      context.fillRect(0, 0, 1, 1);
      const [r, g, b] = context.getImageData(0, 0, 1, 1).data;
      return 0.2126 * channel(r!) + 0.7152 * channel(g!) + 0.0722 * channel(b!);
    };
    const white = luminance("#fff");
    return [...document.querySelectorAll<HTMLElement>(query)]
      .filter((el) => el.getClientRects().length > 0 && (el.textContent ?? "").trim() !== "" && getComputedStyle(el).visibility === "visible")
      .map((el) => {
        const ink = luminance(getComputedStyle(el).color);
        return { text: (el.textContent ?? "").trim().slice(0, 40), ratio: (white + 0.05) / (ink + 0.05) };
      });
  }, selector);
}

/** Textes du navbar et du pied de page sur fond blanc : au moins 4,5:1 partout, barre finale comprise. */
test("navbar et pied de page : textes d'au moins 4,5:1 sur le fond blanc", async ({ page }) => {
  await page.goto("/");
  const header = await contrastsOnWhite(page, "header nav a, header nav summary, header nav button");
  const footer = await contrastsOnWhite(page, "footer h2, footer a, footer p, footer li, footer span");
  expect(header.length).toBeGreaterThan(3);
  expect(footer.length).toBeGreaterThan(10);
  for (const item of [...header, ...footer]) expect(item.ratio, `Contraste de « ${item.text} »`).toBeGreaterThanOrEqual(4.5);
});

/** Focus clavier visible (au moins 3:1 sur blanc) sur un lien du navbar et un lien du pied de page. */
test("navbar et pied de page : le focus clavier reste visible sur blanc", async ({ page }) => {
  await page.goto("/");
  await page.keyboard.press("Tab");
  for (const target of [page.getByRole("banner").getByRole("link", { name: "Services", exact: true }), page.getByRole("contentinfo").getByRole("link", { name: "Tous les produits", exact: true })]) {
    await target.focus();
    const outline = await target.evaluate((el) => {
      const style = getComputedStyle(el);
      return { style: style.outlineStyle, width: Number.parseFloat(style.outlineWidth), color: style.outlineColor };
    });
    expect(outline.style).not.toBe("none");
    expect(outline.width).toBeGreaterThanOrEqual(2);
    const color = outline.color;
    const [ratio] = (await page.evaluate(
      ([c]) => {
        const context = document.createElement("canvas").getContext("2d", { willReadFrequently: true })!;
        const channel = (value: number) => (value / 255 <= 0.03928 ? value / 255 / 12.92 : ((value / 255 + 0.055) / 1.055) ** 2.4);
        context.fillStyle = c!;
        context.fillRect(0, 0, 1, 1);
        const [r, g, b] = context.getImageData(0, 0, 1, 1).data;
        return [1.05 / (0.2126 * channel(r!) + 0.7152 * channel(g!) + 0.0722 * channel(b!) + 0.05)];
      },
      [color],
    )) as number[];
    expect(ratio!, `Contraste du focus (${color})`).toBeGreaterThanOrEqual(3);
  }
});

/**
 * Icônes du navbar agrandies (32 × 32 px) sans toucher aux libellés (14 px, « text-sm »).
 * Lecture seule : visiteur non connecté, valable sur les deux profils.
 */
test("navbar : icônes panier, compte et loupe de 32 px, libellés inchangés, aucun débordement", async ({ page }) => {
  await page.goto("/");
  const banner = page.getByRole("banner");
  const cart = banner.locator('a[href="/panier"]');
  const account = banner.locator('a[href="/connexion"]');
  const search = banner.getByRole("button", { name: "Rechercher", exact: true });
  for (const control of [cart, account, search]) {
    const box = await control.locator("img").boundingBox();
    expect(box?.width).toBeCloseTo(32, 0);
    expect(box?.height).toBeCloseTo(32, 0);
  }
  // Libellés visibles seulement à partir du breakpoint « sm » : mesurés sur le profil bureau.
  if (test.info().project.name === "desktop") {
    await expect(cart.getByText("Panier", { exact: true })).toHaveCSS("font-size", "14px");
    await expect(account.getByText("Se connecter", { exact: true })).toHaveCSS("font-size", "14px");
  }
  const overflow = await banner.evaluate((el) => el.scrollWidth - el.clientWidth);
  expect(overflow).toBeLessThanOrEqual(0);
});

test("navbar : la recherche ouverte ne touche pas les liens centrés, de 1024 à 1280 px", async ({ page }, testInfo) => {
  test.skip(testInfo.project.name !== "desktop", "Sur mobile, la recherche est sur sa propre ligne.");
  for (const width of [1024, 1100, 1279, 1280]) {
    await page.setViewportSize({ width, height: 800 });
    await page.goto("/");
    const banner = page.getByRole("banner");
    const contactBox = (await banner.getByRole("navigation", { name: "Navigation principale" }).getByRole("link", { name: "Contact" }).boundingBox())!;
    await banner.getByRole("button", { name: "Rechercher" }).click();
    const formBox = (await banner.getByRole("search").boundingBox())!;
    expect(contactBox.x + contactBox.width, `largeur ${width}`).toBeLessThanOrEqual(formBox.x);
  }
});

test("navbar : la recherche ouverte recouvre entièrement les icônes panier et compte sur grand écran", async ({ page }, testInfo) => {
  test.skip(testInfo.project.name !== "desktop", "Sur mobile, la recherche est sur sa propre ligne.");
  await page.goto("/");
  const banner = page.getByRole("banner");
  await banner.getByRole("button", { name: "Rechercher", exact: true }).click();
  const bar = (await banner.locator("form", { has: page.getByRole("searchbox") }).boundingBox())!;
  for (const href of ["/panier", "/connexion"]) {
    const icon = (await banner.locator(`a[href="${href}"] img`).boundingBox())!;
    expect(icon.y).toBeGreaterThanOrEqual(bar.y);
    expect(icon.y + icon.height).toBeLessThanOrEqual(bar.y + bar.height);
  }
});

/**
 * Mentions légales : paramètre « company » partagé par toute la base E2E, donc profil bureau uniquement
 * et verrou commun avec les autres fichiers qui le modifient (valeur d'origine restaurée même en cas d'échec).
 */
test.describe("pied de page : mentions légales", () => {
  test.describe.configure({ mode: "serial" });

  let guard: CompanySettingGuard | undefined;

  test.beforeEach(async ({}, testInfo) => {
    test.skip(testInfo.project.name !== "desktop", "Paramètre partagé : vérifié sur le profil bureau uniquement.");
    guard = await guardCompanySetting();
  });

  test.afterEach(async () => {
    const current = guard;
    guard = undefined;
    await current?.restore();
  });

  const company = (legal: { companyName: string; ninea: string | null; rccm: string | null }) => ({
    shopName: "FUTANI SHOP",
    logoUrl: null,
    phone: null,
    whatsapp: null,
    email: null,
    address: null,
    openingHours: null,
    socialLinks: { facebook: null, instagram: null, linkedin: null, tiktok: null, youtube: null, x: null },
    ...legal,
  });

  test("raison sociale toujours affichée, NINEA et RCCM seulement s'ils sont renseignés", async ({ page }) => {
    const footer = page.getByRole("contentinfo");

    // Sans paramètre enregistré : raison sociale par défaut, aucune mention vide.
    await writeCompanySetting(null);
    await page.goto("/");
    await expect(footer.getByText("Raison sociale : FUTANI GROUP", { exact: true })).toBeVisible();
    await expect(footer.getByText(/NINEA|RCCM/)).toHaveCount(0);

    await writeCompanySetting(company({ companyName: "Société E2E", ninea: "0012345 2G3", rccm: null }));
    await page.goto("/");
    await expect(footer.getByText("Raison sociale : Société E2E · NINEA : 0012345 2G3", { exact: true })).toBeVisible();
    await expect(footer.getByText(/RCCM/)).toHaveCount(0);

    await writeCompanySetting(company({ companyName: "Société E2E", ninea: "0012345 2G3", rccm: "SN-DKR-2026-B-1234" }));
    await page.goto("/");
    await expect(footer.getByText("Raison sociale : Société E2E · NINEA : 0012345 2G3 · RCCM : SN-DKR-2026-B-1234", { exact: true })).toBeVisible();
    await expect(footer.getByText(`© ${new Date().getFullYear()} FUTANI GROUP. Tous droits réservés.`, { exact: true })).toBeVisible();
  });

  test("sans lien social enregistré : section « Réseaux sociaux » visible avec 6 icônes non cliquables, copyright visible", async ({ page }) => {
    await writeCompanySetting(company({ companyName: "Société E2E", ninea: null, rccm: null }));
    await page.goto("/");
    const footer = page.getByRole("contentinfo");
    const heading = footer.getByRole("heading", { level: 2, name: "Réseaux sociaux", exact: true });
    await expect(heading).toBeVisible();
    // Section = parent direct du titre. Aucun lien : pas de repère de navigation vide, mais six icônes présentes.
    const section = heading.locator("..");
    await expect(footer.getByRole("navigation", { name: "Réseaux sociaux" })).toHaveCount(0);
    await expect(section.getByRole("img", { name: /\(lien non disponible\)$/ })).toHaveCount(6);
    await expect(section.getByRole("link")).toHaveCount(0);
    await expect(footer.getByText(`© ${new Date().getFullYear()} FUTANI GROUP. Tous droits réservés.`, { exact: true })).toBeVisible();
  });

  test("cadres teintés : fond quasi transparent, bordure visible, réseaux et paiements au style identique, icônes agrandies sans débordement", async ({ page }) => {
    await writeCompanySetting({
      ...company({ companyName: "Société E2E", ninea: null, rccm: null }),
      socialLinks: { facebook: "https://www.facebook.com/futani-e2e", instagram: null, linkedin: null, tiktok: null, youtube: null, x: null },
    });
    await page.goto("/");
    const footer = page.getByRole("contentinfo");
    const socialLink = footer.getByRole("navigation", { name: "Réseaux sociaux" }).getByRole("link", { name: "Facebook (nouvel onglet)" });
    const style = (frame: Locator) =>
      frame.evaluate((el) => {
        const computed = getComputedStyle(el);
        return { background: computed.backgroundColor, border: computed.borderTopColor, borderWidth: computed.borderTopWidth, radius: computed.borderRadius };
      });
    // Alpha lu dans « ... / alpha ) » ou « rgba(r, g, b, alpha) » (absent = opaque).
    const alphaOf = (color: string) => Number(/\/\s*([\d.]+)(%?)\s*\)/.exec(color)?.[1] ?? /rgba\([^,]+,[^,]+,[^,]+,\s*([\d.]+)\)/.exec(color)?.[1] ?? "1");
    const reference = await style(socialLink);
    // Cadre teinté sans ombre interne, logo sans halo (le halo blanc n'a plus d'utilité sur fond blanc).
    expect(await socialLink.evaluate((el) => getComputedStyle(el).boxShadow)).toBe("none");
    expect(await socialLink.locator("img").evaluate((el) => getComputedStyle(el).filter)).toBe("none");
    expect(alphaOf(reference.background)).toBeGreaterThan(0);
    expect(alphaOf(reference.background)).toBeLessThanOrEqual(0.15);
    expect(alphaOf(reference.border)).toBeGreaterThan(0);
    expect(Number.parseFloat(reference.borderWidth)).toBeGreaterThan(0);

    // Réseau : icône d'au moins 32 px dans un bouton d'au moins 44 px.
    const socialIcon = (await socialLink.locator("img").boundingBox())!;
    expect(socialIcon.width).toBeGreaterThanOrEqual(32);
    expect(socialIcon.height).toBeGreaterThanOrEqual(32);
    const socialFrame = (await socialLink.boundingBox())!;
    expect(socialFrame.width).toBeGreaterThanOrEqual(44);
    expect(socialFrame.height).toBeGreaterThanOrEqual(44);

    for (const label of ["Espèces", "Orange Money", "Wave"]) {
      const item = footer.getByRole("listitem").filter({ hasText: label });
      const frame = item.locator("> span").first();
      await expect(frame).toBeVisible();
      expect(await style(frame)).toEqual(reference);
      // Le cadre contient l'icône sans déborder, dans les quatre directions.
      const [frameBox, iconBox] = [(await frame.boundingBox())!, (await frame.locator("img").boundingBox())!];
      expect(iconBox.x).toBeGreaterThanOrEqual(frameBox.x - 0.5);
      expect(iconBox.y).toBeGreaterThanOrEqual(frameBox.y - 0.5);
      expect(iconBox.x + iconBox.width).toBeLessThanOrEqual(frameBox.x + frameBox.width + 0.5);
      expect(iconBox.y + iconBox.height).toBeLessThanOrEqual(frameBox.y + frameBox.height + 0.5);
      // Plus grandes qu'avant (20 px, ou 40 px de large pour Orange Money qui garde sa largeur).
      expect(iconBox.width).toBeGreaterThanOrEqual(label === "Orange Money" ? 40 : 36);
      expect(iconBox.height).toBeGreaterThan(20);
      // Ni lien ni élément focalisable dans la ligne de paiement.
      await expect(item.locator("a, button, [tabindex]")).toHaveCount(0);
      expect(await frame.evaluate((el) => el.tabIndex)).toBe(-1);
      // Pas de survol : le style reste identique souris dessus.
      await frame.hover();
      expect(await style(frame)).toEqual(reference);
      await expect(item.getByText(label, { exact: true })).toBeVisible();
    }
  });

  test("valeurs saisies affichées en texte brut, jamais interprétées comme du HTML", async ({ page }) => {
    await writeCompanySetting(company({ companyName: "Société <b>E2E</b>", ninea: null, rccm: null }));
    await page.goto("/");
    const footer = page.getByRole("contentinfo");
    await expect(footer.getByText("Raison sociale : Société <b>E2E</b>", { exact: true })).toBeVisible();
    await expect(footer.locator("b")).toHaveCount(0);
  });
});

/**
 * Logo du navbar : sur grand écran, l'emblème (F et chariot) dépasse sous le navbar, le texte reste dessus.
 * Le paramètre « company » est partagé : verrou commun et valeurs par défaut (aucun logo téléversé) imposées,
 * valeur d'origine restaurée même en cas d'échec.
 */
test.describe("navbar : logo FUTANI SHOP à emblème débordant", () => {
  test.describe.configure({ mode: "serial" });

  const LOGO_NAME = "FUTANI SHOP, accueil";
  const NAVBAR_HEIGHT = 74;
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

  /** Boîtes (x, y, largeur, hauteur) de l'en-tête et de ses éléments de logo. */
  async function measure(page: Page) {
    const banner = page.getByRole("banner");
    const link = banner.getByRole("link", { name: LOGO_NAME, exact: true });
    const box = async (locator: Locator) => (await locator.boundingBox())!;
    return {
      banner,
      link,
      bannerBox: await box(banner),
      emblem: link.locator('img[src*="embleme"]'),
      text: link.locator('img[src*="texte"]'),
      // Plus de pastille : l'emblème lui-même est l'élément qui dépasse.
      pill: link.locator('img[src*="embleme"]'),
    };
  }

  const overlaps = (a: { x: number; y: number; width: number; height: number }, b: { x: number; y: number; width: number; height: number }) =>
    a.x < b.x + b.width && b.x < a.x + a.width && a.y < b.y + b.height && b.y < a.y + a.height;

  /** Ni fond, ni ombre, ni bordure, ni filtre sur les images du lien ni sur leurs ancêtres jusqu'au lien inclus. */
  async function expectNoBackground(link: Locator) {
    const styles = await link.evaluate((root) => {
      const found: { tag: string; background: string; image: string; shadow: string; border: string; filter: string }[] = [];
      for (const img of root.querySelectorAll("img")) {
        if (getComputedStyle(img).display === "none") continue;
        for (let node: Element | null = img; node; node = node === root ? null : node.parentElement) {
          const c = getComputedStyle(node);
          found.push({ tag: node.tagName, background: c.backgroundColor, image: c.backgroundImage, shadow: c.boxShadow, border: c.borderTopWidth, filter: c.filter });
        }
      }
      return found;
    });
    expect(styles.length).toBeGreaterThan(0);
    for (const style of styles) {
      expect(style.background).toBe("rgba(0, 0, 0, 0)");
      expect(style.image).toBe("none");
      expect(style.shadow).toBe("none");
      expect(style.border).toBe("0px");
      expect(style.filter).toBe("none");
    }
  }

  test("bureau 1280 px : emblème agrandi qui dépasse sous le navbar, texte dans le navbar, un seul lien", async ({ page }) => {
    await page.setViewportSize({ width: 1280, height: 800 });
    await page.goto("/");
    const { banner, link, bannerBox, emblem, text, pill } = await measure(page);

    await expect(emblem).toBeVisible();
    const emblemBox = (await emblem.boundingBox())!;
    const textBox = (await text.boundingBox())!;
    const bannerBottom = bannerBox.y + bannerBox.height;
    expect(emblemBox.height).toBeGreaterThanOrEqual(96);
    const overhang = emblemBox.y + emblemBox.height - bannerBottom;
    expect(overhang).toBeGreaterThanOrEqual(16);
    expect(overhang).toBeLessThanOrEqual(28);
    // Le texte reste entièrement dans le navbar, avec au moins 4 px de marge en bas, et il est descendu
    // (plus bas que le centre du navbar, comme dans le logo d'origine) : bas du texte à 4 à 8 px du bas du navbar.
    expect(textBox.y).toBeGreaterThanOrEqual(bannerBox.y);
    expect(textBox.y + textBox.height).toBeLessThanOrEqual(bannerBottom - 4);
    expect(textBox.y + textBox.height).toBeGreaterThanOrEqual(bannerBottom - 8);
    expect(textBox.y + textBox.height / 2).toBeGreaterThan(bannerBox.y + bannerBox.height / 2);
    // Navbar inchangé en hauteur, sans débordement horizontal.
    expect(bannerBox.height).toBeCloseTo(NAVBAR_HEIGHT, 0);
    expect(await banner.evaluate((el) => el.scrollWidth - el.clientWidth)).toBeLessThanOrEqual(0);
    expect(await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth)).toBeLessThanOrEqual(0);

    // Un seul lien vers « / », nommé une fois : images décoratives, pas de double annonce.
    await expect(banner.locator('a[href="/"]')).toHaveCount(1);
    await expect(link).toHaveCount(1);
    // Le logo complet, masqué sur grand écran (display: none), n'est ni visible ni annoncé.
    await expect(link.locator("img:visible")).toHaveCount(2);
    for (const image of await link.locator("img:visible").all()) await expect(image).toHaveAttribute("alt", "");
    await expect(link.getByRole("img")).toHaveCount(0);

    // L'emblème ne recouvre ni « Catalogue » ni aucun autre contrôle du navbar.
    const pillBox = (await pill.boundingBox())!;
    expect(overlaps(pillBox, (await banner.getByText("Catalogue", { exact: true }).boundingBox())!)).toBe(false);
    for (const control of await banner.locator("nav a, nav summary, nav button").all()) {
      expect(overlaps(pillBox, (await control.boundingBox())!)).toBe(false);
    }
    expect(overlaps(pillBox, textBox)).toBe(false);
    await expectNoBackground(link);
  });

  test("bureau 1280 px : la partie qui dépasse reste au-dessus du contenu, même après défilement", async ({ page }) => {
    await page.setViewportSize({ width: 1280, height: 800 });
    await page.goto("/");
    const { banner, link, pill } = await measure(page);
    for (const scroll of [0, 600]) {
      await page.evaluate((y) => window.scrollTo(0, y), scroll);
      // Boîtes relevées après chaque défilement : le navbar est collé en haut, un bandeau d'annonces peut le décaler au départ.
      const bannerBox = (await banner.boundingBox())!;
      const pillBox = (await pill.boundingBox())!;
      // Point de la pastille situé sous le navbar : l'élément visible à cet endroit appartient au lien du logo.
      const point = { x: pillBox.x + pillBox.width / 2, y: bannerBox.y + bannerBox.height + 6 };
      const insideLink = await link.evaluate((el, { x, y }) => el.contains(document.elementFromPoint(x, y)), point);
      expect(insideLink).toBe(true);
    }
  });

  test("bureau 1280 px : menu Catalogue et recherche ouverts restent utilisables, non recouverts par l'emblème", async ({ page }) => {
    await page.setViewportSize({ width: 1280, height: 800 });
    await page.goto("/");
    const { banner, pill } = await measure(page);
    const pillBox = (await pill.boundingBox())!;

    await banner.getByText("Catalogue", { exact: true }).click();
    const menu = banner.locator("details[open] > ul");
    await expect(menu).toBeVisible();
    const menuBox = (await menu.boundingBox())!;
    expect(overlaps(pillBox, menuBox)).toBe(false);
    // Le point central du menu est bien celui du menu (rien ne le recouvre) et ses liens sont cliquables.
    const covered = await menu.evaluate((el) => {
      const r = el.getBoundingClientRect();
      return !el.contains(document.elementFromPoint(r.x + r.width / 2, r.y + r.height / 2));
    });
    expect(covered).toBe(false);
    await expect(menu.getByRole("link", { name: "Tous les produits", exact: true })).toBeVisible();
    await banner.getByText("Catalogue", { exact: true }).click();
    await expect(menu).toHaveCount(0);

    await banner.getByRole("button", { name: "Rechercher", exact: true }).click();
    const bar = banner.locator("form", { has: page.getByRole("searchbox") });
    await expect(bar).toBeVisible();
    expect(overlaps(pillBox, (await bar.boundingBox())!)).toBe(false);
    const field = page.getByRole("searchbox");
    await field.fill("câble");
    await expect(field).toBeFocused();
    await expect(field).toHaveValue("câble");
  });

  test("tablette 1024 px, visiteur : navbar sur une seule ligne de 74 px, emblème sans recouvrement", async ({ page }) => {
    await page.setViewportSize({ width: 1024, height: 768 });
    await page.goto("/");
    const { banner, bannerBox, pill, emblem, text } = await measure(page);
    await expect(emblem).toBeVisible();
    expect(bannerBox.height).toBeCloseTo(NAVBAR_HEIGHT, 0);
    const textBox = (await text.boundingBox())!;
    expect(textBox.y + textBox.height).toBeLessThanOrEqual(bannerBox.y + bannerBox.height - 4);
    expect(textBox.y + textBox.height).toBeGreaterThanOrEqual(bannerBox.y + bannerBox.height - 8);
    const pillBox = (await pill.boundingBox())!;
    for (const control of await banner.locator("nav a, nav summary, nav button").all()) {
      expect(overlaps(pillBox, (await control.boundingBox())!)).toBe(false);
    }
    expect(await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth)).toBeLessThanOrEqual(0);
  });

  test("tablette 1024 px, connecté avec le rôle ADMIN : liens du compte plus longs, navbar toujours sur une ligne de 74 px", async ({ page }) => {
    await page.setViewportSize({ width: 1024, height: 768 });
    const email = uniqueEmail("e2e-logo");
    await signUp(page, email);
    await grantRole(email, "ADMIN");
    await page.goto("/");
    const { banner, bannerBox, pill } = await measure(page);
    await expect(banner.getByRole("link", { name: "Administration", exact: true })).toBeVisible();
    await expect(banner.getByRole("button", { name: "Se déconnecter", exact: true })).toBeVisible();
    expect(bannerBox.height).toBeCloseTo(NAVBAR_HEIGHT, 0);
    const pillBox = (await pill.boundingBox())!;
    for (const control of await banner.locator("nav a, nav summary, nav button").all()) {
      expect(overlaps(pillBox, (await control.boundingBox())!)).toBe(false);
    }
    expect(await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth)).toBeLessThanOrEqual(0);
  });

  /**
   * Police plus large que celle du poste de développement (Noto Sans ici). L'application utilise la pile système
   * (aucune police chargée) : la largeur dépend donc de la police que le système résout pour « system-ui » ;
   * sur le serveur CI elle est plus large. DejaVu Sans, la plus large des polices locales courantes, ne
   * donne que +6,7 % : on applique un espacement de lettres de 0,1 em (1,4 px par lettre à 14 px),
   * au moins +12 % de largeur de texte, vérifié ci-dessous. Taille de police inchangée (14 px).
   */
  const WIDE_TEXT_MIN_GROWTH = 1.12;
  const WIDE_TEXT_STYLE = "header nav, header nav * { letter-spacing: 0.1em !important; }";

  /** Largeur cumulée du texte visible du navbar (icônes et libellés masqués exclus). */
  async function navTextWidth(banner: Locator): Promise<number> {
    return banner.evaluate((header) => {
      let sum = 0;
      for (const nav of header.querySelectorAll("nav")) {
        const walker = document.createTreeWalker(nav, NodeFilter.SHOW_TEXT);
        for (let node = walker.nextNode(); node; node = walker.nextNode()) {
          // Liste du menu Catalogue (fermée) exclue : elle n'est pas sur la ligne du navbar.
          if (!(node.textContent ?? "").trim() || (node.parentElement?.offsetWidth ?? 0) <= 1 || node.parentElement?.closest("ul")) continue;
          const range = document.createRange();
          range.selectNodeContents(node);
          sum += range.getBoundingClientRect().width;
        }
      }
      return sum;
    });
  }

  /** Élargit le texte du navbar et vérifie que l'élargissement est bien d'au moins 12 %. */
  async function widenNavbarText(page: Page): Promise<void> {
    const banner = page.getByRole("banner");
    const before = await navTextWidth(banner);
    await page.addStyleTag({ content: WIDE_TEXT_STYLE });
    const after = await navTextWidth(banner);
    expect(after / before).toBeGreaterThanOrEqual(WIDE_TEXT_MIN_GROWTH);
    // Le texte reste en 14 px : on réduit l'espace, jamais le texte.
    expect(await banner.getByText("Catalogue", { exact: true }).evaluate((el) => getComputedStyle(el).fontSize)).toBe("14px");
  }

  /** Une seule ligne de 74 px, aucun contrôle sous l'emblème, aucun débordement horizontal. */
  async function expectSingleLineWithoutOverlap(page: Page, label: string): Promise<void> {
    const { banner, bannerBox, pill } = await measure(page);
    expect(bannerBox.height, `hauteur du navbar (${label})`).toBeCloseTo(NAVBAR_HEIGHT, 0);
    const pillBox = (await pill.boundingBox())!;
    for (const control of await banner.locator("nav a, nav summary, nav button").all()) {
      expect(overlaps(pillBox, (await control.boundingBox())!), `chevauchement de l'emblème (${label})`).toBe(false);
    }
    expect(await banner.evaluate((el) => el.scrollWidth - el.clientWidth), `débordement du navbar (${label})`).toBeLessThanOrEqual(0);
    expect(await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth), `débordement horizontal (${label})`).toBeLessThanOrEqual(0);
  }

  test("tablette et petit bureau, connecté avec le rôle ADMIN, police élargie de 12 % : une seule ligne de 74 px à 1024, 1100 et 1279 px", async ({ page }) => {
    await page.setViewportSize({ width: 1024, height: 768 });
    const email = uniqueEmail("e2e-logo-large");
    await signUp(page, email);
    await grantRole(email, "ADMIN");
    await page.goto("/");
    await expect(page.getByRole("banner").getByRole("link", { name: "Administration", exact: true })).toBeVisible();
    await widenNavbarText(page);
    for (const width of [1024, 1100, 1279]) {
      await page.setViewportSize({ width, height: 768 });
      await expectSingleLineWithoutOverlap(page, `ADMIN, ${width} px, police large`);
    }
  });

  test("tablette 1024 px, visiteur, police élargie de 12 % : une seule ligne de 74 px, emblème sans recouvrement", async ({ page }) => {
    await page.setViewportSize({ width: 1024, height: 768 });
    await page.goto("/");
    await widenNavbarText(page);
    await expectSingleLineWithoutOverlap(page, "visiteur, 1024 px, police large");
  });

  /** Boîtes du conteneur du navbar (première div de l'en-tête), du logo, de la navigation principale, de la loupe et du compte. */
  async function layoutBoxes(page: Page) {
    const banner = page.getByRole("banner");
    const box = async (locator: Locator) => (await locator.boundingBox())!;
    return {
      container: await box(banner.locator("xpath=./div")),
      logo: await box(banner.getByRole("link", { name: LOGO_NAME, exact: true })),
      nav: await box(banner.getByRole("navigation", { name: "Navigation principale", exact: true })),
      search: await box(banner.getByRole("button", { name: "Rechercher", exact: true })),
      account: await box(banner.getByRole("navigation", { name: "Compte", exact: true })),
    };
  }

  const centerX = (b: { x: number; width: number }) => b.x + b.width / 2;
  const CENTER_TOLERANCE = 1;

  for (const width of [1280, 1920]) {
    test(`bureau ${width} px, visiteur : la navigation principale est centrée sur le conteneur du navbar`, async ({ page }) => {
      await page.setViewportSize({ width, height: 900 });
      await page.goto("/");
      const { container, nav } = await layoutBoxes(page);
      expect(Math.abs(centerX(nav) - centerX(container))).toBeLessThanOrEqual(CENTER_TOLERANCE);
    });
  }

  test("tablette 1024 px, visiteur : la navigation principale est centrée sur le conteneur du navbar", async ({ page }) => {
    await page.setViewportSize({ width: 1024, height: 768 });
    await page.goto("/");
    const { container, nav } = await layoutBoxes(page);
    expect(Math.abs(centerX(nav) - centerX(container))).toBeLessThanOrEqual(CENTER_TOLERANCE);
  });

  for (const width of [1024, 1280]) {
    test(`bureau ${width} px, connecté avec le rôle ADMIN : logo, navigation et groupe de droite sans chevauchement`, async ({ page }) => {
      await page.setViewportSize({ width, height: 800 });
      const email = uniqueEmail(`e2e-centre-${width}`);
      await signUp(page, email);
      await grantRole(email, "ADMIN");
      await page.goto("/");
      await expect(page.getByRole("banner").getByRole("link", { name: "Administration", exact: true })).toBeVisible();
      const { container, logo, nav, search, account } = await layoutBoxes(page);
      // Marge d'un pixel : les boîtes se touchent sans se recouvrir (écarts de 8 à 12 px entre colonnes).
      expect(logo.x + logo.width, "logo / navigation").toBeLessThanOrEqual(nav.x);
      expect(nav.x + nav.width, "navigation / loupe").toBeLessThanOrEqual(search.x);
      expect(search.x + search.width, "loupe / compte").toBeLessThanOrEqual(account.x + 1);
      expect(account.x + account.width, "compte / bord du conteneur").toBeLessThanOrEqual(container.x + container.width);
      expect(await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth)).toBeLessThanOrEqual(0);
    });
  }

  test("bureau 1280 px : l'ordre de tabulation suit l'ordre visuel (logo, navigation, loupe, compte)", async ({ page }) => {
    await page.setViewportSize({ width: 1280, height: 800 });
    await page.goto("/");
    const banner = page.getByRole("banner");
    const xs = await banner.evaluate((header) => {
      const focusable = [...header.querySelectorAll<HTMLElement>("a[href], summary, button")].filter((el) => el.getClientRects().length > 0);
      // Ordre du DOM = ordre de tabulation (aucun tabindex positif) ; abscisses relevées dans cet ordre.
      return focusable.map((el) => Math.round(el.getBoundingClientRect().x));
    });
    expect(xs.length).toBeGreaterThan(5);
    expect(xs).toEqual([...xs].sort((a, b) => a - b));
  });

  for (const width of [820, 390]) {
    test(`sous lg (${width} px) : navigation à gauche du conteneur, loupe à droite, disposition inchangée`, async ({ page }) => {
      await page.setViewportSize({ width, height: 800 });
      await page.goto("/");
      const { container, logo, nav, search, account } = await layoutBoxes(page);
      const padding = 16;
      expect(Math.abs(nav.x - (container.x + padding))).toBeLessThanOrEqual(1);
      expect(Math.abs(search.x + search.width - (container.x + container.width - padding))).toBeLessThanOrEqual(padding);
      expect(search.x).toBeGreaterThan(nav.x + nav.width - 1);
      // Deux lignes : marque et compte en haut, navigation et loupe dessous.
      expect(nav.y).toBeGreaterThanOrEqual(logo.y + logo.height - 1);
      expect(Math.abs(account.y + account.height / 2 - (logo.y + logo.height / 2))).toBeLessThan(logo.height);
    });
  }

  test("mobile : logo complet visible, sans dépassement sous le navbar ni débordement horizontal", async ({ page }) => {
    await page.goto("/");
    const banner = page.getByRole("banner");
    const link = banner.getByRole("link", { name: LOGO_NAME, exact: true });
    // Logo complet d'origine : une seule image, ni emblème ni texte séparés.
    const full = link.locator("img:visible");
    await expect(full).toHaveCount(1);
    await expect(full).toBeVisible();
    await expect(link.locator('img[src*="embleme"]:visible, img[src*="texte"]:visible')).toHaveCount(0);
    const bannerBox = (await banner.boundingBox())!;
    const imageBox = (await full.boundingBox())!;
    expect(imageBox.y + imageBox.height).toBeLessThanOrEqual(bannerBox.y + bannerBox.height);
    expect(imageBox.x).toBeGreaterThanOrEqual(0);
    // Logo complet nu et décoratif, navbar sur deux lignes de 126 px comme avant.
    await expect(full).toHaveAttribute("alt", "");
    await expectNoBackground(link);
    expect(bannerBox.height).toBeCloseTo(126, 0);
    expect(await banner.evaluate((el) => el.scrollWidth - el.clientWidth)).toBeLessThanOrEqual(0);
    expect(await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth)).toBeLessThanOrEqual(0);
  });

  test("logo téléversé (bureau) : affiché tel quel, sans dépassement et sans emblème", async ({ page }) => {
    await page.setViewportSize({ width: 1280, height: 800 });
    // Fichier déposé dans le stockage E2E (jamais celui du développement), retiré en fin de test.
    const name = `logo-${crypto.randomUUID()}.png`;
    const file = `./storage-e2e/identite/${name}`;
    await mkdir("./storage-e2e/identite", { recursive: true });
    await copyFile("./public/logos/futani-group.png", file);
    try {
      await writeCompanySetting({
        shopName: "FUTANI SHOP",
        companyName: "FUTANI GROUP",
        logoUrl: `/medias/identite/${name}`,
        phone: null,
        whatsapp: null,
        email: null,
        address: null,
        openingHours: null,
        ninea: null,
        rccm: null,
        socialLinks: { facebook: null, instagram: null, linkedin: null, tiktok: null, youtube: null, x: null },
      });
      await page.goto("/");
      const banner = page.getByRole("banner");
      const link = banner.getByRole("link", { name: LOGO_NAME, exact: true });
      const uploaded = link.locator("img");
      await expect(uploaded).toHaveCount(1);
      await expect(uploaded).toHaveAttribute("src", `/medias/identite/${name}`);
      await expect(uploaded).toHaveJSProperty("complete", true);
      expect(await uploaded.evaluate((img: HTMLImageElement) => img.naturalWidth)).toBeGreaterThan(0);
      await expect(link.locator('img[src*="embleme"], img[src*="texte"]')).toHaveCount(0);
      const bannerBox = (await banner.boundingBox())!;
      const imageBox = (await uploaded.boundingBox())!;
      expect(imageBox.y).toBeGreaterThanOrEqual(bannerBox.y);
      expect(imageBox.y + imageBox.height).toBeLessThanOrEqual(bannerBox.y + bannerBox.height);
      // Logo téléversé (36 px de haut) : navbar de 72 px, déterminé par la navigation ; il ne dépasse pas les 74 px.
      expect(bannerBox.height).toBeLessThanOrEqual(NAVBAR_HEIGHT);
      expect(await banner.evaluate((el) => el.scrollWidth - el.clientWidth)).toBeLessThanOrEqual(0);
    } finally {
      await rm(file, { force: true });
    }
  });
});
