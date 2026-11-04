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

  // Emplacement : sous les colonnes Boutique, Aide et Contact.
  const footer = page.getByRole("contentinfo");
  const socialBox = (await footer.getByRole("navigation", { name: "Réseaux sociaux" }).boundingBox())!;
  for (const column of [footer.getByRole("navigation", { name: "Boutique" }), footer.getByRole("navigation", { name: "Aide" }), footer.getByRole("heading", { name: "Contact" })]) {
    const box = (await column.boundingBox())!;
    expect(socialBox.y).toBeGreaterThanOrEqual(box.y + box.height);
  }
  await page.screenshot({ path: testInfo.outputPath("pied-de-page-reseaux.png"), fullPage: true });
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
    companyName: "SYSTELEC",
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
