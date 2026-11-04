import { expect, test, type Locator, type Page } from "@playwright/test";
import { grantRole } from "./support/db";
import { signUp, uniqueEmail } from "./support/flows";

/**
 * Affichage du bandeau d'annonces : fenêtre de dates, liens, rotation, rendu bureau et mobile.
 * Le réglage « announcements » est partagé par toute la base E2E : les tests qui le modifient
 * fortement (plusieurs annonces, durée de défilement) ne tournent que sur le profil bureau et en série,
 * pour rester sous la limite de 10 annonces quand les autres fichiers tournent en parallèle.
 */
test.describe.configure({ mode: "serial" });

const MAX_SLIDES = 10;
const BAR_NAME = "Annonces et promotions";
/** Avance manuelle sans défilement automatique concurrent (sinon une annonce peut être sautée). */
const STEPPING_CONTEXT = { reducedMotion: "reduce" } as const;

interface NewAnnouncement {
  text: string;
  href?: string;
  kind?: "ANNOUNCEMENT" | "PROMOTION";
  startsAt?: string;
  endsAt?: string;
}

const uniqueText = (prefix: string) => `${prefix} ${Math.random().toString(36).slice(2, 8)}`;

/** Date « datetime-local » (heure de Dakar = UTC) décalée de `hours` par rapport à maintenant. */
function localDateTime(hours: number): string {
  return new Date(Date.now() + hours * 3_600_000).toISOString().slice(0, 16);
}

async function signInAsSuperAdmin(page: Page): Promise<void> {
  const email = uniqueEmail("e2e-annonces-affichage");
  await signUp(page, email, "Administrateur principal E2E");
  await grantRole(email, "SUPER_ADMIN");
}

function addForm(page: Page): Locator {
  return page.locator("form").filter({ has: page.getByRole("button", { name: "Ajouter l'annonce" }) });
}

async function addAnnouncement(page: Page, item: NewAnnouncement): Promise<void> {
  await page.goto("/admin/annonces");
  const form = addForm(page);
  await form.getByLabel("Texte").fill(item.text);
  if (item.href) await form.getByLabel("Lien").fill(item.href);
  await form.getByLabel("Type").selectOption(item.kind ?? "ANNOUNCEMENT");
  if (item.startsAt) await form.getByLabel("Début d'affichage").fill(item.startsAt);
  if (item.endsAt) await form.getByLabel("Fin d'affichage").fill(item.endsAt);
  await form.getByRole("button", { name: "Ajouter l'annonce" }).click();
  await expect(page.getByText("Annonce ajoutée.")).toBeVisible();
}

function rowOf(page: Page, text: string): Locator {
  return page.locator("article").filter({ has: page.locator(`input[value="${text}"]`) });
}

async function removeAnnouncements(page: Page, texts: readonly string[]): Promise<void> {
  for (const text of texts) {
    await page.goto("/admin/annonces");
    const row = rowOf(page, text);
    if ((await row.count()) === 0) continue;
    page.once("dialog", (dialog) => void dialog.accept());
    await row.getByRole("button", { name: "Supprimer" }).click();
    await expect(row).toHaveCount(0);
  }
}

/** Textes de toutes les annonces affichées sur `path`, en avançant à la main (bandeau absent : liste vide). */
async function visibleSlides(page: Page, path = "/"): Promise<string[]> {
  await page.goto(path);
  const bar = page.getByRole("region", { name: BAR_NAME });
  if ((await bar.count()) === 0) return [];
  const texts: string[] = [];
  const next = bar.getByRole("button", { name: "Annonce suivante" });
  for (let step = 0; step < MAX_SLIDES; step += 1) {
    const current = (await bar.innerText()).trim();
    if (texts.includes(current)) break;
    texts.push(current);
    if ((await next.count()) === 0) break;
    await next.click();
    await expect(bar).not.toHaveText(current);
  }
  return texts;
}

/** Textes de toutes les annonces de la page courante, sans la recharger (bandeau absent : liste vide). */
async function slidesInPlace(page: Page): Promise<string[]> {
  const bar = page.getByRole("region", { name: BAR_NAME });
  if ((await bar.count()) === 0) return [];
  const texts: string[] = [];
  const next = bar.getByRole("button", { name: "Annonce suivante" });
  for (let step = 0; step < MAX_SLIDES; step += 1) {
    const current = (await bar.innerText()).trim();
    if (texts.includes(current)) break;
    texts.push(current);
    if ((await next.count()) === 0) break;
    await next.click();
    await expect(bar).not.toHaveText(current);
  }
  return texts;
}

async function showSlide(bar: Locator, text: string): Promise<void> {
  const next = bar.getByRole("button", { name: "Annonce suivante" });
  for (let step = 0; step < MAX_SLIDES && !(await bar.getByText(text).isVisible()); step += 1) {
    if ((await next.count()) === 0) break;
    await next.click();
  }
  await expect(bar).toContainText(text);
}

test.describe("bandeau d'annonces : affichage", () => {
  test("fenêtre de dates : une annonce future ou expirée n'est pas affichée, une annonce en cours l'est", async ({ page, browser }, testInfo) => {
    test.skip(testInfo.project.name !== "desktop", "Réglage partagé : vérifié sur le profil bureau uniquement.");
    const future = uniqueText("Future E2E");
    const expired = uniqueText("Expiree E2E");
    const current = uniqueText("En cours E2E");
    await signInAsSuperAdmin(page);
    try {
      await addAnnouncement(page, { text: future, startsAt: localDateTime(24) });
      await addAnnouncement(page, { text: expired, startsAt: localDateTime(-48), endsAt: localDateTime(-24) });
      await addAnnouncement(page, { text: current, startsAt: localDateTime(-1), endsAt: localDateTime(24) });

      const visitor = await browser.newPage(STEPPING_CONTEXT);
      try {
        const slides = (await visibleSlides(visitor)).join("\n");
        expect(slides).toContain(current);
        expect(slides).not.toContain(future);
        expect(slides).not.toContain(expired);
      } finally {
        await visitor.close();
      }

      // Fin avant le début : refusé sur le champ.
      const form = addForm(page);
      await form.getByLabel("Texte").fill(uniqueText("Dates inversees E2E"));
      await form.getByLabel("Début d'affichage").fill(localDateTime(48));
      await form.getByLabel("Fin d'affichage").fill(localDateTime(24));
      await form.getByRole("button", { name: "Ajouter l'annonce" }).click();
      await expect(page.getByText("La fin doit suivre le début")).toBeVisible();
    } finally {
      await removeAnnouncements(page, [future, expired, current]);
    }
  });

  test("une annonce désactivée disparaît du bandeau", async ({ page, browser }, testInfo) => {
    test.skip(testInfo.project.name !== "desktop", "Réglage partagé : vérifié sur le profil bureau uniquement.");
    const text = uniqueText("Inactive E2E");
    await signInAsSuperAdmin(page);
    try {
      await addAnnouncement(page, { text });
      const row = rowOf(page, text);
      await row.getByLabel("Active (affichée sur le site)").uncheck();
      await row.getByRole("button", { name: "Enregistrer l'annonce" }).click();
      await expect(page.getByText("Annonce enregistrée.")).toBeVisible();

      const visitor = await browser.newPage(STEPPING_CONTEXT);
      try {
        expect((await visibleSlides(visitor)).join("\n")).not.toContain(text);
      } finally {
        await visitor.close();
      }
    } finally {
      await removeAnnouncements(page, [text]);
    }
  });

  test("liens : interne dans l'onglet, https dans un nouvel onglet isolé, adresses dangereuses refusées", async ({ page, browser }, testInfo) => {
    test.skip(testInfo.project.name !== "desktop", "Réglage partagé : vérifié sur le profil bureau uniquement.");
    const internal = uniqueText("Lien interne E2E");
    const external = uniqueText("Lien externe E2E");
    await signInAsSuperAdmin(page);
    try {
      await addAnnouncement(page, { text: internal, href: "/produits" });
      await addAnnouncement(page, { text: external, href: "https://example.com/offre", kind: "PROMOTION" });

      for (const href of ["javascript:alert(1)", "http://example.com", "//evil.example", "https://user:pw@example.com"]) {
        const form = addForm(page);
        await form.getByLabel("Texte").fill(uniqueText("Lien refuse E2E"));
        await form.getByLabel("Lien").fill(href);
        await form.getByRole("button", { name: "Ajouter l'annonce" }).click();
        await expect(page.getByText("Annonce ajoutée.")).toHaveCount(0);
        await expect(form.getByLabel("Lien")).toHaveAttribute("aria-invalid", "true");
        await page.reload();
      }

      const visitor = await browser.newPage(STEPPING_CONTEXT);
      try {
        await visitor.goto("/");
        const bar = visitor.getByRole("region", { name: BAR_NAME });
        await showSlide(bar, external);
        const externalLink = bar.getByRole("link", { name: new RegExp(external) });
        await expect(externalLink).toHaveAttribute("href", "https://example.com/offre");
        await expect(externalLink).toHaveAttribute("target", "_blank");
        await expect(externalLink).toHaveAttribute("rel", "noopener noreferrer");

        await showSlide(bar, internal);
        const internalLink = bar.getByRole("link", { name: new RegExp(internal) });
        await expect(internalLink).toHaveAttribute("href", "/produits");
        await expect(internalLink).not.toHaveAttribute("target", "_blank");
        await internalLink.click();
        await expect(visitor).toHaveURL(/\/produits$/);
      } finally {
        await visitor.close();
      }
    } finally {
      await removeAnnouncements(page, [internal, external]);
    }
  });

  test("rotation : défilement automatique, pause au survol, aucun défilement si animations réduites", async ({ page, browser }, testInfo) => {
    test.skip(testInfo.project.name !== "desktop", "Réglage partagé : vérifié sur le profil bureau uniquement.");
    test.setTimeout(90_000);
    const texts = [uniqueText("Rotation A E2E"), uniqueText("Rotation B E2E")];
    await signInAsSuperAdmin(page);
    await page.goto("/admin/annonces");
    const rotationInput = page.getByLabel("Secondes par annonce");
    const previousRotation = await rotationInput.inputValue();
    try {
      for (const text of texts) await addAnnouncement(page, { text });
      await page.goto("/admin/annonces");
      await page.getByLabel("Secondes par annonce").fill("4");
      await page.getByRole("button", { name: "Enregistrer la durée" }).click();
      await expect(page.getByText("Durée d'affichage enregistrée.")).toBeVisible();

      const context = await browser.newContext({ reducedMotion: "no-preference" });
      const visitor = await context.newPage();
      try {
        await visitor.goto("/");
        const bar = visitor.getByRole("region", { name: BAR_NAME });
        await expect(bar.getByRole("button", { name: "Annonce suivante" })).toBeVisible();
        const first = ((await bar.textContent()) ?? "").trim();
        await expect(bar).not.toHaveText(first, { timeout: 9_000 });

        // Pause au survol : rien ne change pendant plus d'une période.
        await bar.hover();
        const hovered = ((await bar.textContent()) ?? "").trim();
        await visitor.waitForTimeout(6_000);
        await expect(bar).toHaveText(hovered);
        await visitor.mouse.move(0, 600);
        await expect(bar).not.toHaveText(hovered, { timeout: 9_000 });

        // Bouton Pause / Reprendre au clavier (WCAG 2.2.2) : la pause tient, la reprise relance le défilement
        // alors que le focus reste sur le bouton.
        const pause = bar.getByRole("button", { name: "Mettre en pause le défilement des annonces" });
        await pause.focus();
        await visitor.keyboard.press("Enter");
        const resume = bar.getByRole("button", { name: "Reprendre le défilement des annonces" });
        await expect(resume).toBeFocused();
        const pausedText = ((await bar.textContent()) ?? "").trim();
        await visitor.waitForTimeout(6_000);
        await expect(bar).toHaveText(pausedText);
        await visitor.keyboard.press("Enter");
        await expect(pause).toBeFocused();
        await expect(bar).not.toHaveText(pausedText, { timeout: 9_000 });
      } finally {
        await context.close();
      }

      const reduced = await browser.newContext({ reducedMotion: "reduce" });
      const calm = await reduced.newPage();
      try {
        await calm.goto("/");
        const bar = calm.getByRole("region", { name: BAR_NAME });
        await expect(bar.getByRole("button", { name: "Annonce suivante" })).toBeVisible();
        // Aucun défilement automatique : pas de bouton Pause.
        await expect(bar.getByRole("button", { name: /défilement des annonces/ })).toHaveCount(0);
        const shown = ((await bar.textContent()) ?? "").trim();
        await calm.waitForTimeout(6_000);
        await expect(bar).toHaveText(shown);
        await bar.getByRole("button", { name: "Annonce suivante" }).click();
        await expect(bar).not.toHaveText(shown);
      } finally {
        await reduced.close();
      }
    } finally {
      await page.goto("/admin/annonces");
      await page.getByLabel("Secondes par annonce").fill(previousRotation);
      await page.getByRole("button", { name: "Enregistrer la durée" }).click();
      await expect(page.getByText("Durée d'affichage enregistrée.")).toBeVisible();
      await removeAnnouncements(page, texts);
    }
  });

  test("mobile : le bouton Pause se commande au toucher et arrête le défilement", async ({ page }, testInfo) => {
    test.skip(testInfo.project.name !== "mobile", "Interaction tactile : profil mobile uniquement.");
    test.setTimeout(90_000);
    const texts = [uniqueText("Toucher A E2E"), uniqueText("Toucher B E2E")];
    await signInAsSuperAdmin(page);
    try {
      for (const text of texts) await addAnnouncement(page, { text });
      await page.emulateMedia({ reducedMotion: "no-preference" });
      await page.goto("/");
      const bar = page.getByRole("region", { name: BAR_NAME });
      const pause = bar.getByRole("button", { name: "Mettre en pause le défilement des annonces" });
      await expect(pause).toBeVisible();
      const box = await pause.boundingBox();
      // Cible tactile d'au moins 24 × 24 px (WCAG 2.2, critère 2.5.8).
      expect(Math.min(box!.width, box!.height)).toBeGreaterThanOrEqual(24);
      await pause.tap();
      const resume = bar.getByRole("button", { name: "Reprendre le défilement des annonces" });
      await expect(resume).toBeVisible();
      const pausedText = ((await bar.textContent()) ?? "").trim();
      // Plus d'une période (20 s au plus) sans changement : on attend la durée maximale autorisée + marge.
      await page.waitForTimeout(8_000);
      await expect(bar).toHaveText(pausedText);
      await resume.tap();
      await expect(pause).toBeVisible();
      await expect(bar).not.toHaveText(pausedText, { timeout: 25_000 });
    } finally {
      await removeAnnouncements(page, texts);
    }
  });

  test("navigation interne : une annonce qui expire disparaît sans rechargement de la page", async ({ page, browser }, testInfo) => {
    test.skip(testInfo.project.name !== "desktop", "Réglage partagé : vérifié sur le profil bureau uniquement.");
    test.setTimeout(240_000);
    const text = uniqueText("Expire bientot E2E");
    // Fin à la minute (champ « datetime-local ») : entre 60 et 120 secondes après maintenant.
    const end = new Date(Math.ceil((Date.now() + 60_000) / 60_000) * 60_000);
    await signInAsSuperAdmin(page);
    try {
      await addAnnouncement(page, { text, endsAt: end.toISOString().slice(0, 16) });
      const visitor = await browser.newPage(STEPPING_CONTEXT);
      try {
        await visitor.goto("/");
        const bar = visitor.getByRole("region", { name: BAR_NAME });
        await showSlide(bar, text);
        // Repère posé dans la page : il disparaîtrait avec un rechargement complet.
        await visitor.evaluate(() => Object.assign(window, { __sansRechargement: true }));
        await visitor.getByRole("banner").getByRole("link", { name: "Services" }).first().click();
        await expect(visitor).toHaveURL(/\/services/);
        // Mise en page conservée par la navigation interne : l'annonce est toujours là avant l'échéance.
        if (Date.now() < end.getTime() - 5_000) await showSlide(bar, text);
        // Après l'échéance : rafraîchissement automatique, l'annonce n'est plus dans aucune diapositive.
        await expect.poll(async () => (await slidesInPlace(visitor)).some((slide) => slide.includes(text)), { timeout: end.getTime() - Date.now() + 30_000, intervals: [5_000] }).toBe(false);
        expect(await visitor.evaluate(() => (window as unknown as { __sansRechargement?: boolean }).__sansRechargement)).toBe(true);
      } finally {
        await visitor.close();
      }
    } finally {
      await removeAnnouncements(page, [text]);
    }
  });

  test("navigation interne boutique ↔ administration : bandeau masqué sous /admin, réaffiché sur la boutique, sans rechargement", async ({ page }, testInfo) => {
    test.skip(testInfo.project.name !== "desktop", "Liens d'en-tête du profil bureau.");
    const text = uniqueText("Navigation admin E2E");
    await signInAsSuperAdmin(page);
    try {
      await addAnnouncement(page, { text });
      await page.emulateMedia({ reducedMotion: "reduce" });
      await page.goto("/");
      const bar = page.getByRole("region", { name: BAR_NAME });
      await showSlide(bar, text);
      // Repère posé dans la page : il disparaîtrait avec un rechargement complet.
      await page.evaluate(() => Object.assign(window, { __sansRechargement: true }));

      await page.getByRole("navigation", { name: "Compte" }).getByRole("link", { name: "Administration" }).click();
      await expect(page).toHaveURL(/\/admin$/);
      await expect(page.getByRole("navigation", { name: "Administration" })).toBeVisible();
      await expect(bar).toHaveCount(0);

      await page.getByRole("navigation", { name: "Administration" }).getByRole("link", { name: "Annonces" }).click();
      await expect(page).toHaveURL(/\/admin\/annonces$/);
      await expect(bar).toHaveCount(0);

      // « Voir sur la boutique » : rendu public dans un nouvel onglet, l'administration reste ouverte.
      const preview = page.getByRole("link", { name: /Voir sur la boutique/ });
      await expect(preview).toHaveAttribute("target", "_blank");
      await expect(preview).toHaveAttribute("rel", "noopener noreferrer");
      const [shop] = await Promise.all([page.context().waitForEvent("page"), preview.click()]);
      await shop.emulateMedia({ reducedMotion: "reduce" });
      await expect(shop).toHaveURL(/\/$/);
      await showSlide(shop.getByRole("region", { name: BAR_NAME }), text);
      await shop.close();
      await expect(page).toHaveURL(/\/admin\/annonces$/);

      await page.getByRole("link", { name: /accueil$/ }).first().click();
      await expect(page).toHaveURL(/\/$/);
      await showSlide(bar, text);
      expect(await page.evaluate(() => (window as unknown as { __sansRechargement?: boolean }).__sansRechargement)).toBe(true);

      // Pages introuvables : sous /admin, pas de bandeau ; ailleurs, bandeau présent ; aucune erreur d'hydratation.
      const hydrationErrors: string[] = [];
      page.on("console", (message) => {
        if (message.type() === "error" && /hydrat/i.test(message.text())) hydrationErrors.push(message.text());
      });
      await page.goto("/admin/page-inexistante-e2e");
      await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
      await expect(bar).toHaveCount(0);
      await page.goto("/page-inexistante-e2e");
      await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
      await showSlide(bar, text);
      expect(hydrationErrors).toEqual([]);
    } finally {
      await removeAnnouncements(page, [text]);
    }
  });

  test("rendu : bandeau au-dessus de l'en-tête, sans débordement horizontal (bureau et mobile)", async ({ page }, testInfo) => {
    const text = uniqueText("Rendu E2E texte un peu long pour verifier le retour a la ligne sur telephone");
    await signInAsSuperAdmin(page);
    try {
      await addAnnouncement(page, { text, href: "/produits", kind: "PROMOTION" });
      // Même profil d'appareil que le projet (bureau ou Pixel 7) ; le bandeau est identique pour tous.
      await page.emulateMedia({ reducedMotion: "reduce" });
      await page.goto("/");
      const bar = page.getByRole("region", { name: BAR_NAME });
      await showSlide(bar, text);
      const barBox = await bar.boundingBox();
      const headerBox = await page.locator("header").first().boundingBox();
      expect(barBox!.y + barBox!.height).toBeLessThanOrEqual(headerBox!.y + 1);
      const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
      expect(overflow).toBeLessThanOrEqual(0);
      await page.screenshot({ path: testInfo.outputPath(`bandeau-accueil-${testInfo.project.name}.png`) });
      // Autre page publique que l'accueil : bandeau présent.
      await page.goto("/panier");
      await showSlide(page.getByRole("region", { name: BAR_NAME }), text);
      // Back-office : bandeau absent, y compris sur la gestion des annonces (dont l'écran reste utilisable).
      for (const path of ["/admin", "/admin/annonces"]) {
        await page.goto(path);
        await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
        await expect(page.getByRole("region", { name: BAR_NAME })).toHaveCount(0);
      }
      await page.screenshot({ path: testInfo.outputPath(`bandeau-admin-${testInfo.project.name}.png`) });
    } finally {
      await removeAnnouncements(page, [text]);
    }
  });
});
