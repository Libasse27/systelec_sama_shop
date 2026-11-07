import { expect, test, type Page } from "@playwright/test";
import { grantRole, guardCompanySetting, writeCompanySetting, type CompanySettingGuard } from "./support/db";
import { signUp, uniqueEmail } from "./support/flows";

test.describe("formulaire de contact et boîte « Messages »", () => {
  test("un invité écrit, le service client prend en charge, annote et clôt le message", async ({ page, browser }) => {
    const sender = `Ndeye ${Math.random().toString(36).slice(2, 8)}`;

    // 1. L'invité envoie un message depuis la page Contact.
    await page.goto("/contact");
    const submit = page.getByRole("button", { name: "Envoyer le message" });
    await expect(submit).toBeEnabled();
    await page.getByLabel("Nom complet").fill(sender);
    await page.getByLabel("Sujet").selectOption("AFTER_SALES");
    await page.getByLabel("Votre message").fill("Mon imprimante achetée la semaine dernière ne s'allume plus.");
    // Sans e-mail ni téléphone, le message est refusé.
    await submit.click();
    await expect(page.getByText("Indiquez un e-mail ou un téléphone")).toBeVisible();
    await page.getByLabel("Téléphone").fill("77 123 45 67");
    await submit.click();
    await expect(page).toHaveURL(/\/contact\?envoye=MSG-\d{4}-\d{6}/);
    const status = page.getByRole("status").filter({ hasText: "Message envoyé" });
    await expect(status).toBeVisible();
    const number = (await status.locator("strong").textContent())!.trim();

    // 2. Le service client le retrouve dans la boîte et le traite.
    const staff = await browser.newPage();
    const email = uniqueEmail("e2e-contact");
    await signUp(staff, email, "Service client E2E");
    await grantRole(email, "CUSTOMER_SERVICE");
    await staff.goto(`/admin/messages?q=${number}`);
    await staff.getByRole("link", { name: number }).click();
    await expect(staff.getByRole("heading", { level: 1 })).toHaveText(`Message ${number}`);
    await expect(staff.getByText("Mon imprimante achetée")).toBeVisible();

    await staff.getByRole("button", { name: "Prendre en charge" }).click();
    await expect(staff.getByText("Message pris en charge.")).toBeVisible();
    await staff.getByLabel("Notes internes").fill("Rappel prévu, prise en charge garantie.");
    await staff.getByRole("button", { name: "Enregistrer les notes" }).click();
    await expect(staff.getByText("Notes enregistrées.")).toBeVisible();
    await staff.getByRole("button", { name: "Marquer comme traité" }).click();
    await expect(staff.getByText("Message marqué comme traité.")).toBeVisible();

    await staff.goto("/admin/messages?statut=CLOSED");
    await expect(staff.getByRole("link", { name: number })).toBeVisible();
    await staff.close();
  });

  test("la boîte « Messages » est fermée à un compte client", async ({ page }) => {
    await signUp(page, uniqueEmail("e2e-contact-client"));
    await page.goto("/admin/messages");
    await expect(page).toHaveURL(/\/acces-refuse/);
  });
});

/**
 * Canaux directs (e-mail, WhatsApp, téléphone) : coordonnées uniquement issues du paramètre « company »,
 * partagé par toute la base E2E. Profil bureau uniquement pour les tests qui l'écrivent (verrou et
 * restauration par guardCompanySetting), comme e2e/social-links.spec.ts.
 */
test.describe("canaux de contact directs", () => {
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

  async function seedCoordinates(coordinates: { phone: string | null; whatsapp: string | null; email: string | null }): Promise<void> {
    const base = (guard?.original ?? {}) as Record<string, unknown>;
    await writeCompanySetting({
      companyName: "FUTANI GROUP",
      shopName: "FUTANI SHOP",
      logoUrl: null,
      address: null,
      openingHours: null,
      ninea: null,
      rccm: null,
      socialLinks: { facebook: null, instagram: null, linkedin: null, tiktok: null, youtube: null, x: null },
      ...base,
      ...coordinates,
    });
  }

  test("coordonnées complètes : trois liens dans l'ordre, href exacts, WhatsApp dans un nouvel onglet", async ({ page }) => {
    await seedCoordinates({ phone: "+221 70 000 00 00", whatsapp: "+221 70 000 00 01", email: "e2e-contact@exemple.test" });
    await page.goto("/contact");

    const section = channelsSection(page);
    await expect(section.getByRole("heading", { name: "Contactez-nous directement" })).toBeVisible();
    const cards = section.getByRole("listitem");
    await expect(cards).toHaveCount(3);
    await expect(cards.nth(0)).toContainText("Par e-mail");
    await expect(cards.nth(1)).toContainText("Par WhatsApp");
    await expect(cards.nth(2)).toContainText("Par téléphone");

    const email = section.getByRole("link", { name: /Par e-mail/ });
    await expect(email).toHaveAttribute("href", "mailto:e2e-contact@exemple.test");
    await expect(email).toContainText("e2e-contact@exemple.test");
    const whatsapp = section.getByRole("link", { name: /Par WhatsApp/ });
    await expect(whatsapp).toHaveAttribute("href", "https://wa.me/221700000001");
    await expect(whatsapp).toHaveAttribute("target", "_blank");
    await expect(whatsapp).toHaveAttribute("rel", "noopener noreferrer");
    await expect(whatsapp).toHaveAccessibleName(/nouvel onglet/);
    await expect(whatsapp).toContainText("+221 70 000 00 01");
    const phone = section.getByRole("link", { name: /Par téléphone/ });
    await expect(phone).toHaveAttribute("href", "tel:+221700000000");
    await expect(phone).toContainText("+221 70 000 00 00");
    await expect(section.getByText("Bientôt disponible")).toHaveCount(0);

    for (const link of [email, whatsapp, phone]) {
      const box = (await link.boundingBox())!;
      expect(box.height).toBeGreaterThanOrEqual(44);
      expect(box.width).toBeGreaterThanOrEqual(44);
      expect(decodeURIComponent((await link.locator("img").getAttribute("src")) ?? "")).toContain("/icones/");
    }
    // Une valeur plus longue passe sur deux lignes : les trois cartes gardent la même hauteur.
    const heights = await Promise.all([email, whatsapp, phone].map(async (link) => (await link.boundingBox())!.height));
    expect(new Set(heights).size).toBe(1);
    // Le formulaire reste présent et son pré-remplissage ?service= fonctionne.
    await expect(page.getByRole("button", { name: "Envoyer le message" })).toBeVisible();
    await page.goto("/contact?service=developpement-web-fullstack&objet=devis");
    await expect(channelsSection(page).getByRole("link")).toHaveCount(3);
    await expect(page.getByLabel("Votre message")).toHaveValue(/Concernant le service/);
    await expect(page.getByLabel("Sujet")).toHaveValue("QUOTE");
  });

  test("coordonnées absentes : trois cartes visibles, aucun lien, « Bientôt disponible »", async ({ page }) => {
    await seedCoordinates({ phone: null, whatsapp: null, email: null });
    await page.goto("/contact");

    const section = channelsSection(page);
    await expect(section.getByRole("listitem")).toHaveCount(3);
    await expect(section.getByRole("link")).toHaveCount(0);
    await expect(section.getByText("Bientôt disponible")).toHaveCount(3);
    for (const label of ["Par e-mail", "Par WhatsApp", "Par téléphone"]) {
      await expect(section.getByText(label)).toBeVisible();
    }
    await expect(section.locator("[href], [tabindex]")).toHaveCount(0);
    await expect(section.getByText("[DÉMO]")).toHaveCount(0);
    await expect(page.getByRole("button", { name: "Envoyer le message" })).toBeVisible();
  });

  test("valeurs invalides : cartes inactives, sans mailto, wa.me ni tel", async ({ page }) => {
    await seedCoordinates({ phone: "bientôt", whatsapp: "12 34", email: "contact@exemple.test?bcc=pirate@exemple.test" });
    await page.goto("/contact");

    const section = channelsSection(page);
    await expect(section.getByRole("listitem")).toHaveCount(3);
    await expect(section.getByRole("link")).toHaveCount(0);
    await expect(section.getByText("Bientôt disponible")).toHaveCount(3);
    await expect(page.locator('main a[href^="mailto:"], main a[href^="tel:"], main a[href^="https://wa.me"]')).toHaveCount(0);
  });

  test("valeur invalide isolée : seule la carte concernée est inactive", async ({ page }) => {
    await seedCoordinates({ phone: "+221 70 000 00 00", whatsapp: "pas un numéro", email: "e2e-contact@exemple.test" });
    await page.goto("/contact");

    const section = channelsSection(page);
    await expect(section.getByRole("link")).toHaveCount(2);
    await expect(section.getByText("Bientôt disponible")).toHaveCount(1);
    await expect(section.getByRole("listitem").nth(1)).toContainText("Bientôt disponible");
  });
});

test("canaux de contact : aucun débordement horizontal, une colonne sur mobile, trois à partir de md", async ({ page }, testInfo) => {
  // Aucune écriture du paramètre : lecture seule, valable sur les deux profils.
  for (const width of [1280, 820, 390]) {
    await page.setViewportSize({ width, height: 900 });
    await page.goto("/contact");
    const cards = channelsSection(page).getByRole("listitem");
    await expect(cards).toHaveCount(3);
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
    expect(overflow, `largeur ${width}px (${testInfo.project.name})`).toBeLessThanOrEqual(0);
    const tops = await Promise.all([0, 1, 2].map(async (index) => (await cards.nth(index).boundingBox())!.y));
    if (width >= 768) expect(new Set(tops.map(Math.round)).size).toBe(1);
    else expect(new Set(tops.map(Math.round)).size).toBe(3);
  }
});

function channelsSection(page: Page) {
  return page.getByRole("region", { name: "Contactez-nous directement" });
}
