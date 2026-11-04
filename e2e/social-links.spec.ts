import { expect, test, type Page } from "@playwright/test";
import { grantRole, guardCompanySetting, readCompanySetting, writeCompanySetting, type CompanySettingGuard } from "./support/db";
import { signUp, uniqueEmail } from "./support/flows";

/**
 * Liens des réseaux sociaux : saisis dans Paramètres (settings.manage), validés sur le domaine officiel
 * du réseau, affichés dans le pied de page. Le paramètre « company » est partagé par toute la base E2E :
 * profil bureau uniquement, tests isolés par guardCompanySetting (verrou partagé avec les autres fichiers
 * qui modifient ce paramètre, valeur d'origine restaurée à l'identique même en cas d'échec).
 */
const IDENTITY_SAVED = "Identité et mentions légales enregistrées.";

// Les deux tests modifient le même paramètre partagé : jamais en parallèle.
test.describe.configure({ mode: "serial" });

const DESKTOP_ONLY = "Paramètre partagé : vérifié sur le profil bureau uniquement.";
/** Isolement du paramètre partagé « company » (undefined : test ignoré, rien à restaurer). */
let guard: CompanySettingGuard | undefined;

test.beforeEach(async ({}, testInfo) => {
  test.skip(testInfo.project.name !== "desktop", DESKTOP_ONLY);
  guard = await guardCompanySetting();
});

test.afterEach(async () => {
  const current = guard;
  guard = undefined;
  await current?.restore();
});

/** Champ de saisie (le pied de page peut aussi porter un lien « Facebook »). */
const facebookField = (page: Page) => page.getByRole("textbox", { name: /^Facebook/ });

async function saveFacebook(page: Page, href: string): Promise<void> {
  await page.goto("/admin/parametres");
  await facebookField(page).fill(href);
  await page.getByRole("button", { name: "Enregistrer l'identité", exact: true }).click();
}

test("liens sociaux : lien raccourci refusé avec un message clair, lien officiel affiché dans le pied de page", async ({ page }, testInfo) => {
  const email = uniqueEmail("e2e-reseaux");
  await signUp(page, email, "Administrateur E2E");
  await grantRole(email, "ADMIN");
  const profile = `https://www.facebook.com/futani-e2e-${Math.random().toString(36).slice(2, 8)}`;
  await saveFacebook(page, "https://fb.me/futani");
  await expect(page.getByText(/Lien Facebook : les liens raccourcis ou de redirection ne sont pas acceptés/)).toBeVisible();
  await expect(facebookField(page)).toHaveAttribute("aria-invalid", "true");

  await saveFacebook(page, "https://evilfacebook.com/futani");
  await expect(page.getByText("Lien Facebook : cette adresse n'appartient pas au domaine officiel de Facebook.")).toBeVisible();

  await saveFacebook(page, profile);
  await expect(page.getByText(IDENTITY_SAVED)).toBeVisible();
  await page.goto("/");
  const link = page.getByRole("navigation", { name: "Réseaux sociaux" }).getByRole("link", { name: "Facebook (nouvel onglet)" });
  await expect(link).toHaveAttribute("href", profile);
  await expect(link).toHaveAttribute("rel", "noopener noreferrer");

  // Emplacement : section dédiée « Réseaux sociaux », sur la rangée de Contact et Paiement, à droite de Paiement, sous le logo.
  const footer = page.getByRole("contentinfo");
  const socialHeading = footer.getByRole("heading", { level: 2, name: "Réseaux sociaux", exact: true });
  await expect(socialHeading).toBeVisible();
  const socialNav = footer.getByRole("navigation", { name: "Réseaux sociaux" });
  await expect(socialNav).toHaveCount(1);
  await expect(socialNav.getByRole("link", { name: "Facebook (nouvel onglet)" })).toBeVisible();
  const headingBox = async (name: string) => (await footer.getByRole("heading", { level: 2, name, exact: true }).boundingBox())!;
  const [socialBox, contactBox, paymentBox] = [await headingBox("Réseaux sociaux"), await headingBox("Contact"), await headingBox("Paiement")];
  const logoBox = (await footer.getByRole("link", { name: /, accueil$/ }).boundingBox())!;
  expect(Math.abs(socialBox.y - contactBox.y)).toBeLessThanOrEqual(1);
  expect(Math.abs(socialBox.y - paymentBox.y)).toBeLessThanOrEqual(1);
  expect(socialBox.x).toBeGreaterThan(paymentBox.x);
  expect(socialBox.y).toBeGreaterThanOrEqual(logoBox.y + logoBox.height);
  await page.screenshot({ path: testInfo.outputPath("pied-de-page-reseaux.png"), fullPage: true });
});

test("section réseaux sociaux : 6 boutons d'au moins 44×44 px, sans débordement, icônes locales, sur trois largeurs", async ({ page }, testInfo) => {
  const base = (guard?.original ?? {}) as Record<string, unknown>;
  // Profils fictifs sur les domaines acceptés par src/lib/social-links.ts.
  await writeCompanySetting({
    companyName: "FUTANI GROUP",
    shopName: "FUTANI SHOP",
    logoUrl: null,
    phone: null,
    whatsapp: null,
    email: null,
    address: null,
    openingHours: null,
    ninea: null,
    rccm: null,
    ...base,
    socialLinks: {
      facebook: "https://www.facebook.com/futani-e2e",
      instagram: "https://www.instagram.com/futani-e2e",
      linkedin: "https://www.linkedin.com/company/futani-e2e",
      tiktok: "https://www.tiktok.com/@futani-e2e",
      youtube: "https://www.youtube.com/@futani-e2e",
      x: "https://x.com/futani-e2e",
    },
  });
  const viewports = [
    { width: 1280, height: 800 },
    { width: 820, height: 1100 },
    { width: 390, height: 844 },
  ];
  for (const viewport of viewports) {
    await page.setViewportSize(viewport);
    await page.goto("/");
    const footer = page.getByRole("contentinfo");
    const links = footer.getByRole("navigation", { name: "Réseaux sociaux" }).getByRole("link");
    await expect(links).toHaveCount(6);
    for (const link of await links.all()) {
      await expect(link).toBeVisible();
      const box = (await link.boundingBox())!;
      expect(box.width).toBeGreaterThanOrEqual(44);
      expect(box.height).toBeGreaterThanOrEqual(44);
      const src = await link.locator("img").getAttribute("src");
      expect(decodeURIComponent(src ?? "")).toContain("/icones/");
    }
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
    expect(overflow).toBeLessThanOrEqual(0);
    await footer.scrollIntoViewIfNeeded();
    await footer.screenshot({ path: testInfo.outputPath(`footer-social-${viewport.width}.png`) });
  }
});

test("anciens liens non conformes en base : masqués un par un, n'empêchent pas d'enregistrer l'identité, corrigeables individuellement", async ({ page }) => {
  const email = uniqueEmail("e2e-reseaux");
  await signUp(page, email, "Administrateur E2E");
  await grantRole(email, "ADMIN");
  const base = (guard?.original ?? {}) as Record<string, unknown>;
  const instagram = "https://www.instagram.com/futani-e2e";
  // Une valeur par cas : protocole dangereux, conforme, domaine non autorisé, sans https, http, vide.
  const legacyLinks = {
    facebook: "javascript:alert(1)",
    instagram,
    linkedin: "https://evil.example/futani",
    tiktok: "tiktok.com/@futani",
    youtube: "http://youtube.com/futani",
    x: null,
  };
  const address = `Adresse E2E ${Math.random().toString(36).slice(2, 8)}`;
  const footerSocial = () => page.getByRole("navigation", { name: "Réseaux sociaux" });
  const storedLinks = async () => ((await readCompanySetting()) as { socialLinks: unknown }).socialLinks;
  const saveIdentity = async () => {
    await page.getByRole("button", { name: "Enregistrer l'identité", exact: true }).click();
    await expect(page.getByText(IDENTITY_SAVED)).toBeVisible();
  };

  // Donnée historique écrite directement (antérieure aux règles actuelles), comme en production.
  await writeCompanySetting({
    companyName: "FUTANI GROUP",
    shopName: "FUTANI SHOP",
    logoUrl: null,
    phone: null,
    whatsapp: null,
    email: null,
    address: null,
    openingHours: null,
    ninea: null,
    rccm: null,
    ...base,
    socialLinks: legacyLinks,
  });

  // Pied de page : seul le lien conforme est publié, le reste du pied de page fonctionne.
  await page.goto("/");
  await expect(footerSocial().getByRole("link", { name: "Instagram (nouvel onglet)" })).toHaveAttribute("href", instagram);
  await expect(footerSocial().getByRole("link")).toHaveCount(1);
  await expect(page.locator('footer a[href^="javascript:"], footer a[href^="http://"], footer a[href*="evil.example"], footer a[href*="tiktok.com"]')).toHaveCount(0);
  await expect(page.getByRole("contentinfo").getByText(/Tous droits réservés/)).toBeVisible();

  // Paramètres : avertissement clair, raison sous chaque champ concerné.
  await page.goto("/admin/parametres");
  await expect(page.getByRole("alert").filter({ hasText: "non affiché(s) sur le site" })).toBeVisible();
  await expect(page.getByRole("textbox", { name: /^YouTube/ })).toHaveAccessibleDescription(/Non affiché sur le site\. Lien YouTube : l'adresse doit commencer par https:\/\//);
  await expect(page.getByRole("textbox", { name: /^LinkedIn/ })).toHaveAccessibleDescription(/domaine officiel de LinkedIn/);
  await expect(page.getByRole("textbox", { name: /^Facebook/ })).toHaveValue("javascript:alert(1)");

  // Les autres informations s'enregistrent ; les anciens liens sont conservés exactement.
  await page.getByRole("textbox", { name: /^Adresse/ }).fill(address);
  await saveIdentity();
  expect(await readCompanySetting()).toMatchObject({ address });
  expect(await storedLinks()).toEqual(legacyLinks);

  // Champ vidé volontairement : seul ce lien est effacé.
  await page.goto("/admin/parametres");
  await page.getByRole("textbox", { name: /^TikTok/ }).fill("");
  await saveIdentity();
  expect(await storedLinks()).toEqual({ ...legacyLinks, tiktok: null });

  // Correction individuelle : le lien YouTube corrigé réapparaît, les autres anciens liens restent masqués.
  await page.goto("/admin/parametres");
  await page.getByRole("textbox", { name: /^YouTube/ }).fill("https://www.youtube.com/@futani-e2e");
  await saveIdentity();
  expect(await storedLinks()).toEqual({ ...legacyLinks, tiktok: null, youtube: "https://www.youtube.com/@futani-e2e" });
  await page.goto("/");
  await expect(page.getByText(address)).toBeVisible();
  await expect(footerSocial().getByRole("link", { name: "YouTube (nouvel onglet)" })).toHaveAttribute("href", "https://www.youtube.com/@futani-e2e");
  await expect(footerSocial().getByRole("link", { name: "Facebook (nouvel onglet)" })).toHaveCount(0);
  await expect(footerSocial().getByRole("link")).toHaveCount(2);
});

/* ------------------------------------------------------------------------------------------------
 * Couverture complète des 6 réseaux : administration vers pied de page, effacement, sécurité des
 * liens, clavier et accessibilité, survol, chargement des icônes. Adresses fictives (base E2E seule).
 * ---------------------------------------------------------------------------------------------- */
type Network = "facebook" | "instagram" | "linkedin" | "tiktok" | "youtube" | "x";

interface NetworkCase {
  network: Network;
  /** Début du nom du champ dans /admin/parametres. */
  field: RegExp;
  /** Nom accessible du lien dans le pied de page. */
  linkName: string;
  icon: string;
  href: string;
  host: string;
}

/** Dans l'ordre d'affichage du pied de page. */
const NETWORKS: readonly NetworkCase[] = [
  { network: "facebook", field: /^Facebook/, linkName: "Facebook (nouvel onglet)", icon: "/icones/facebook.png", href: "https://www.facebook.com/futani-e2e", host: "www.facebook.com" },
  { network: "instagram", field: /^Instagram/, linkName: "Instagram (nouvel onglet)", icon: "/icones/instagram.png", href: "https://www.instagram.com/futani-e2e", host: "www.instagram.com" },
  { network: "linkedin", field: /^LinkedIn/, linkName: "LinkedIn (nouvel onglet)", icon: "/icones/linkedin.png", href: "https://www.linkedin.com/company/futani-e2e", host: "www.linkedin.com" },
  { network: "tiktok", field: /^TikTok/, linkName: "TikTok (nouvel onglet)", icon: "/icones/tiktok.png", href: "https://www.tiktok.com/@futani-e2e", host: "www.tiktok.com" },
  { network: "youtube", field: /^YouTube/, linkName: "YouTube (nouvel onglet)", icon: "/icones/youtube.png", href: "https://www.youtube.com/@futani-e2e", host: "www.youtube.com" },
  { network: "x", field: /^X \(Twitter\)/, linkName: "X (Twitter) (nouvel onglet)", icon: "/icones/x.png", href: "https://x.com/futani-e2e", host: "x.com" },
];

const socialNav = (page: Page) => page.getByRole("contentinfo").getByRole("navigation", { name: "Réseaux sociaux" });
const socialLink = (page: Page, item: NetworkCase) => socialNav(page).getByRole("link", { name: item.linkName, exact: true });

/** Compte ADMIN créé et connecté. */
async function signInAdmin(page: Page): Promise<void> {
  const email = uniqueEmail("e2e-reseaux");
  await signUp(page, email, "Administrateur E2E");
  await grantRole(email, "ADMIN");
}

/** Écrit directement les 6 profils fictifs dans la base E2E (le garde restaure la valeur d'origine). */
async function seedAllProfiles(): Promise<void> {
  const base = (guard?.original ?? {}) as Record<string, unknown>;
  await writeCompanySetting({
    companyName: "FUTANI GROUP",
    shopName: "FUTANI SHOP",
    logoUrl: null,
    phone: null,
    whatsapp: null,
    email: null,
    address: null,
    openingHours: null,
    ninea: null,
    rccm: null,
    ...base,
    socialLinks: Object.fromEntries(NETWORKS.map((item) => [item.network, item.href])),
  });
}

async function saveIdentityForm(page: Page): Promise<void> {
  await page.getByRole("button", { name: "Enregistrer l'identité", exact: true }).click();
  await expect(page.getByText(IDENTITY_SAVED)).toBeVisible();
}

/** Valeur calculée d'une propriété CSS sur le premier élément trouvé. */
const computed = (link: ReturnType<typeof socialLink>, property: "box-shadow" | "background-color") =>
  link.evaluate((element, name) => getComputedStyle(element).getPropertyValue(name), property);

test("administration vers pied de page : les 6 réseaux saisis, conservés après rechargement, sans croisement nom/href/icône", async ({ page }) => {
  await signInAdmin(page);
  await page.goto("/admin/parametres");
  for (const item of NETWORKS) await page.getByRole("textbox", { name: item.field }).fill(item.href);
  await saveIdentityForm(page);

  await page.reload();
  for (const item of NETWORKS) await expect(page.getByRole("textbox", { name: item.field })).toHaveValue(item.href);

  await page.goto("/");
  const links = socialNav(page).getByRole("link");
  await expect(links).toHaveCount(NETWORKS.length);
  for (const [index, item] of NETWORKS.entries()) {
    const link = socialLink(page, item);
    await expect(link).toHaveCount(1);
    await expect(link).toHaveAttribute("href", item.href);
    // Image du bouton : sa source (optimisée par next/image) pointe vers la bonne icône, pas vers une autre.
    const src = decodeURIComponent((await link.locator("img").getAttribute("src")) ?? "");
    expect(src).toContain(`url=${item.icon}`);
    for (const other of NETWORKS.filter((candidate) => candidate !== item)) expect(src).not.toContain(`url=${other.icon}`);
    // Ordre d'affichage.
    await expect(links.nth(index)).toHaveAttribute("href", item.href);
  }
});

test("effacement : vider un champ ne retire que ce réseau, tout vider supprime la section", async ({ page }) => {
  await signInAdmin(page);
  await seedAllProfiles();
  await page.goto("/admin/parametres");
  const cleared = NETWORKS[3]!; // TikTok
  await page.getByRole("textbox", { name: cleared.field }).fill("");
  await saveIdentityForm(page);

  await page.goto("/");
  await expect(socialNav(page).getByRole("link")).toHaveCount(5);
  await expect(socialLink(page, cleared)).toHaveCount(0);
  for (const item of NETWORKS.filter((candidate) => candidate !== cleared)) {
    await expect(socialLink(page, item)).toHaveAttribute("href", item.href);
  }

  await page.goto("/admin/parametres");
  await expect(page.getByRole("textbox", { name: cleared.field })).toHaveValue("");
  for (const item of NETWORKS) await page.getByRole("textbox", { name: item.field }).fill("");
  await saveIdentityForm(page);

  await page.goto("/");
  const footer = page.getByRole("contentinfo");
  await expect(footer.getByText(/Tous droits réservés/)).toBeVisible();
  await expect(socialNav(page)).toHaveCount(0);
  await expect(footer.getByRole("heading", { level: 2, name: "Réseaux sociaux", exact: true })).toHaveCount(0);
});

test("sécurité des liens : nouvel onglet isolé, https, et aucun autre lien du pied de page vers un réseau social", async ({ page }) => {
  await seedAllProfiles();
  await page.goto("/");
  const links = socialNav(page).getByRole("link");
  await expect(links).toHaveCount(NETWORKS.length);
  for (const item of NETWORKS) {
    const link = socialLink(page, item);
    await expect(link).toHaveAttribute("target", "_blank");
    await expect(link).toHaveAttribute("rel", /(?=.*\bnoopener\b)(?=.*\bnoreferrer\b)/);
    await expect(link).toHaveAttribute("href", /^https:\/\//);
  }

  // Hors de la section : aucun lien du pied de page ne vise un domaine de réseau social.
  const networkHost = /(^|\.)(facebook|fb|instagram|instagr|linkedin|tiktok|youtube|youtu|twitter|x)\.(com|am|be)$/i;
  const outside = await page.getByRole("contentinfo").locator("a[href]").evaluateAll(
    (anchors, nav) => anchors.filter((anchor) => !document.querySelector(nav)?.contains(anchor)).map((anchor) => (anchor as HTMLAnchorElement).href),
    'footer nav[aria-label="Réseaux sociaux"]',
  );
  for (const href of outside) {
    const host = new URL(href, "http://localhost").hostname;
    expect(networkHost.test(host), `Lien hors section vers un réseau : ${href}`).toBe(false);
  }
});

for (const viewport of [
  { width: 1280, height: 800 },
  { width: 820, height: 1100 },
  { width: 390, height: 844 },
]) {
  test(`clavier et accessibilité à ${viewport.width} px : Tab dans l'ordre, anneau de focus, nom accessible, Entrée et clic ouvrent un nouvel onglet`, async ({ page, context }) => {
    await seedAllProfiles();
    // Aucune requête ne doit joindre un vrai site : tout ce qui sort de l'application est servi localement.
    const external: string[] = [];
    await context.route(
      (url) => url.hostname !== "localhost",
      async (route) => {
        external.push(route.request().url());
        await route.fulfill({ status: 200, contentType: "text/html", body: "<!doctype html><title>stub</title>" });
      },
    );
    await page.setViewportSize(viewport);
    await page.goto("/");
    await socialNav(page).scrollIntoViewIfNeeded();

    // Atteindre le premier lien avec Tab depuis le début de la page.
    const activeHref = () => page.evaluate(() => (document.activeElement as HTMLAnchorElement | null)?.href ?? "");
    const firstHref = NETWORKS[0]!.href;
    await page.evaluate(() => (document.activeElement as HTMLElement | null)?.blur());
    let reached = false;
    for (let press = 0; press < 150 && !reached; press++) {
      await page.keyboard.press("Tab");
      reached = (await activeHref()) === firstHref;
    }
    expect(reached, "Le premier lien social doit être atteignable avec Tab").toBe(true);

    for (const [index, item] of NETWORKS.entries()) {
      if (index > 0) await page.keyboard.press("Tab");
      const link = socialLink(page, item);
      expect(await activeHref(), `Focus attendu sur ${item.linkName}`).toBe(item.href);
      await expect(link).toBeFocused();
      expect(await computed(link, "box-shadow"), `Anneau de focus absent sur ${item.linkName}`).not.toBe("none");
      await expect(link).toHaveAccessibleName(item.linkName);
      await expect(link.locator("img")).toHaveAttribute("alt", "");
    }

    // Entrée sur le lien focalisé (le dernier, X) ouvre un nouvel onglet ; la page d'origine reste en place.
    const last = NETWORKS[NETWORKS.length - 1]!;
    const [viaKeyboard] = await Promise.all([context.waitForEvent("page"), page.keyboard.press("Enter")]);
    await viaKeyboard.waitForLoadState("domcontentloaded");
    expect(viaKeyboard.url()).toBe(last.href);
    await viaKeyboard.close();
    expect(new URL(page.url()).hostname).toBe("localhost");

    // Clic à la souris : même comportement, sur un autre lien.
    const first = NETWORKS[0]!;
    const [viaMouse] = await Promise.all([context.waitForEvent("page"), socialLink(page, first).click()]);
    await viaMouse.waitForLoadState("domcontentloaded");
    expect(viaMouse.url()).toBe(first.href);
    await viaMouse.close();
    expect(new URL(page.url()).hostname).toBe("localhost");

    // Seules les deux ouvertures voulues ont atteint (le stub) un hôte externe.
    expect(external.filter((url) => NETWORKS.some((item) => url.startsWith(item.href)))).toHaveLength(2);
  });
}

test("survol à 1280 px : le style calculé du bouton change", async ({ page }) => {
  await seedAllProfiles();
  await page.setViewportSize({ width: 1280, height: 800 });
  await page.goto("/");
  for (const item of NETWORKS) {
    const link = socialLink(page, item);
    await link.scrollIntoViewIfNeeded();
    await page.mouse.move(0, 0);
    await expect.poll(() => computed(link, "box-shadow")).toBe("none");
    const before = { shadow: await computed(link, "box-shadow"), background: await computed(link, "background-color") };
    await link.hover();
    await expect
      .poll(async () => (await computed(link, "box-shadow")) !== before.shadow || (await computed(link, "background-color")) !== before.background, { message: `Aucun changement au survol de ${item.linkName}` })
      .toBe(true);
  }
});

test("chargement réel : l'image de chaque bouton est chargée (naturalWidth > 0)", async ({ page }) => {
  await seedAllProfiles();
  await page.goto("/");
  for (const item of NETWORKS) {
    const link = socialLink(page, item);
    await link.scrollIntoViewIfNeeded();
    const image = link.locator("img");
    await expect.poll(() => image.evaluate((element) => (element as HTMLImageElement).complete && (element as HTMLImageElement).naturalWidth), { message: `Image non chargée : ${item.linkName}` }).toBeGreaterThan(0);
  }
});
