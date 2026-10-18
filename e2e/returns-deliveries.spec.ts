import { expect, test, type Page } from "@playwright/test";
import { createTestProduct, grantRole, hideTestCategory } from "./support/db";
import { addToCart, signUp, uniqueEmail } from "./support/flows";

/** Signature PNG suffisante pour le contrôle du format réel côté serveur. */
const PNG = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 0x0d, 0x49, 0x48, 0x44, 0x52]);

async function guestOrder(page: Page, slug: string, method: "PICKUP" | "DELIVERY"): Promise<{ number: string; trackingUrl: string }> {
  await addToCart(page, slug, 2);
  await page.goto("/commande");
  await page.getByLabel("Nom complet").fill("Mariama Ba");
  await page.getByLabel("Téléphone").fill(`77 ${Math.floor(100 + Math.random() * 899)} 12 34`);
  if (method === "PICKUP") {
    await page.getByLabel(/Retrait gratuit — \[DÉMO\] Boutique/).check();
  } else {
    await page.getByLabel(/Livraison — \[DÉMO\] Zone A/).check();
    await page.getByRole("textbox", { name: "Adresse" }).fill("Cité Keur Gorgui, villa 7");
    await page.getByLabel("Quartier").fill("Sacré-Cœur");
  }
  await page.getByRole("button", { name: "Confirmer la commande" }).click();
  await expect(page).toHaveURL(/\/commande\/CMD-\d{4}-\d{6}\?jeton=/);
  const number = (await page.getByRole("heading", { level: 1 }).textContent())!.replace("Commande ", "").trim();
  return { number, trackingUrl: page.url() };
}

async function staffPage(page: Page, roles: string[], name: string): Promise<{ email: string }> {
  const email = uniqueEmail("e2e-p10");
  await signUp(page, email, name);
  for (const role of roles) await grantRole(email, role);
  return { email };
}

async function submit(page: Page, button: string | RegExp, message: string | RegExp, confirm = false): Promise<void> {
  const locator = page.getByRole("button", { name: button, exact: typeof button === "string" });
  await expect(locator).toBeEnabled();
  if (confirm) page.once("dialog", (dialog) => dialog.accept());
  await locator.click();
  await expect(page.getByText(message)).toBeVisible();
}

async function openOrder(staff: Page, number: string): Promise<void> {
  await staff.goto(`/admin/commandes?q=${number}`);
  await staff.getByRole("link", { name: number }).click();
  await expect(staff.getByRole("heading", { name: `Commande ${number}` })).toBeVisible();
}

test.describe("retours et livraisons (phase 10)", () => {
  const categories: string[] = [];
  test.afterAll(async () => {
    for (const id of categories) await hideTestCategory(id);
  });

  test("le client déclare un retour en ligne avec photo, répond à la vérification ; décision et remboursement par deux personnes", async ({ page, browser }) => {
    test.setTimeout(120_000);
    const product = await createTestProduct({ price: 12_000, onHand: 5 });
    categories.push(product.categoryId);
    const { number, trackingUrl } = await guestOrder(page, product.slug, "PICKUP");

    // Commande remise au client en boutique.
    const staff = await browser.newPage();
    await staffPage(staff, ["ORDER_MANAGER", "FINANCE_MANAGER"], "Gestion P10");
    await openOrder(staff, number);
    await submit(staff, "Confirmée", "Commande passée à « Confirmée ».");
    await submit(staff, "Enregistrer l'encaissement", /Encaissement enregistré : reçu REC-/, true);
    await submit(staff, "En préparation", "Commande passée à « En préparation ».");
    await submit(staff, "Prête au retrait", "Commande passée à « Prête au retrait ».");
    await submit(staff, "Remise au client", "Commande passée à « Remise au client ».", true);

    // L'invité signale le problème depuis son lien de suivi, avec une photo.
    await page.goto(trackingUrl);
    await page.getByText("Signaler un produit endommagé, défectueux ou non conforme").click();
    await page.getByLabel(/au plus 2\)/).fill("1");
    await page.getByLabel("Motif").selectOption({ label: "Produit défectueux ou en panne" });
    await page.getByLabel("Description du problème").fill("Ne s'allume plus après une journée d'utilisation");
    await page.getByLabel("Photos").last().setInputFiles({ name: "defaut.png", mimeType: "image/png", buffer: PNG });
    await submit(page, "Envoyer ma demande", /Demande de retour RET-\d{4}-\d{6} enregistrée/);
    const returnNumber = (await page.getByText(/Demande de retour RET-\d{4}-\d{6} enregistrée/).textContent())!.match(/RET-\d{4}-\d{6}/)![0];
    await page.reload();
    await expect(page.getByText(`Retour ${returnNumber}`)).toBeVisible();
    await expect(page.getByText("Demande reçue, en cours d'examen")).toBeVisible();

    // Notification interne : la demande en ligne apparaît sur le tableau de bord ; photo privée lisible par le personnel seulement.
    const reviewer = await browser.newPage();
    await staffPage(reviewer, ["ORDER_MANAGER", "FINANCE_MANAGER"], "Décideur P10");
    await reviewer.goto("/admin");
    const alerts = reviewer.getByRole("region", { name: "Alertes retours" });
    await alerts.getByRole("link", { name: returnNumber }).click();
    await expect(reviewer.getByRole("heading", { name: `Retour ${returnNumber}` })).toBeVisible();
    await expect(reviewer.getByText("par le client lui-même (en ligne)")).toBeVisible();
    const photoSrc = await reviewer.getByRole("img", { name: /Photo 1 du client/ }).getAttribute("src");
    expect((await reviewer.request.get(photoSrc!)).status()).toBe(200);
    // Sans session du personnel : aucune image (redirection vers la connexion, jamais la photo).
    const anonymous = await page.request.get(photoSrc!, { maxRedirects: 0 });
    expect(anonymous.status()).not.toBe(200);
    expect(anonymous.headers()["content-type"] ?? "").not.toContain("image/");
    const returnUrl = reviewer.url();

    // Vérification demandée : le client la voit et répond en ligne.
    await reviewer.getByLabel("Nature de la vérification").selectOption({ label: "Photos" });
    await reviewer.getByLabel("Précisions demandées").fill("Photo de l'étiquette du numéro de série");
    await submit(reviewer, "Demander la vérification", "Vérification demandée.");
    await page.reload();
    await expect(page.getByText("Photo de l'étiquette du numéro de série")).toBeVisible();
    await page.getByLabel("Votre réponse").fill("Voici l'étiquette");
    await submit(page, "Envoyer ma réponse", "Réponse envoyée. Nous reprenons l'examen de votre demande.");

    // Décision par un responsable, qui ne peut pas verser lui-même le remboursement (décision 1).
    await reviewer.goto(returnUrl);
    await reviewer.getByLabel("Motif de la décision").fill("Panne confirmée au test");
    await submit(reviewer, "Accepter le retour", "Retour accepté.", true);
    await expect(reviewer.getByText("Vous avez décidé ce retour : une autre personne autorisée verse le remboursement")).toBeVisible();
    await expect(reviewer.getByRole("button", { name: /^Rembourser / })).toHaveCount(0);
    await reviewer.close();

    // Une autre personne autorisée verse le remboursement.
    await staff.goto(returnUrl);
    await submit(staff, /^Rembourser .+ en espèces$/, /Remboursement versé : reçu REC-/, true);
    await staff.close();

    await page.reload();
    await expect(page.getByText(/Demande acceptée\. Remboursement de .+ versé\./)).toBeVisible();
  });

  test("livreur interne : compte relié, ses livraisons seulement, départ, encaissement, livraison", async ({ page, browser }) => {
    test.setTimeout(120_000);
    const product = await createTestProduct({ price: 9_000, onHand: 4 });
    categories.push(product.categoryId);
    const { number } = await guestOrder(page, product.slug, "DELIVERY");

    // Compte individuel du livreur (rôle Livreur).
    const courierPage = await browser.newPage();
    const courierName = `Livreur P10 ${Date.now()}`;
    const { email } = await staffPage(courierPage, ["COURIER"], courierName);

    const dispatcher = await browser.newPage();
    await staffPage(dispatcher, ["ORDER_MANAGER", "DELIVERY_MANAGER"], "Dispatch P10");
    await dispatcher.goto("/admin/livraison");
    const couriers = dispatcher.getByRole("region", { name: "Livreurs" });
    await couriers.getByLabel("Nom du livreur ou du transporteur").last().fill(courierName);
    await couriers.getByLabel("Téléphone").last().fill("77 111 22 33");
    await couriers.getByLabel("Type").last().selectOption({ label: "Livreur interne (compte)" });
    await couriers.getByLabel("Compte du livreur interne").last().selectOption({ label: `${courierName} (${email})` });
    await couriers.getByRole("button", { name: "Ajouter le livreur" }).click();
    await expect(dispatcher.getByText("Livreur ajouté.")).toBeVisible();

    await openOrder(dispatcher, number);
    await submit(dispatcher, "Confirmée", "Commande passée à « Confirmée ».");
    await dispatcher.getByLabel("Livreur", { exact: true }).selectOption({ label: `${courierName} (0 en cours)` });
    await submit(dispatcher, "Assigner le livreur", "Livreur assigné.");
    await submit(dispatcher, "En préparation", "Commande passée à « En préparation ».");
    await submit(dispatcher, "Prête à livrer", "Commande passée à « Prête à livrer ».");
    await dispatcher.close();

    // Le livreur ne voit que « Mes livraisons » ; pas les commandes ni la caisse.
    await courierPage.goto("/admin/mes-livraisons");
    await expect(courierPage.getByRole("heading", { name: `Commande ${number} · Livreur assigné` })).toBeVisible();
    await expect(courierPage.getByRole("navigation", { name: "Administration" }).getByRole("link", { name: "Commandes" })).toHaveCount(0);
    await submit(courierPage, "Je pars livrer", "Départ enregistré.");
    await submit(courierPage, /^Encaisser .+ en espèces$/, /Espèces encaissées : reçu REC-/, true);
    await courierPage.getByLabel("Remise à (nom)").fill("Mariama Ba");
    await submit(courierPage, "Livraison effectuée", "Livraison effectuée.");
    await expect(courierPage.getByRole("heading", { name: `Commande ${number} · Livrée` })).toBeVisible();

    for (const path of ["/admin/commandes", "/admin/encaissements", "/admin/retours"]) {
      await courierPage.goto(path);
      await expect(courierPage).toHaveURL(/acces-refuse/);
    }
    const overflow = await courierPage.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
    expect(overflow).toBeLessThanOrEqual(0);
    await courierPage.close();
  });

  test("paramètres : jours fériés et délais de relance enregistrés ; dossier des photos jamais public", async ({ page }) => {
    await staffPage(page, ["ADMIN"], "Admin P10");
    await page.goto("/admin/parametres");
    const hours = page.getByRole("region", { name: "Heures ouvrables et jours fériés (retours)" });
    await hours.getByLabel("Jours fériés").fill("2026-12-25\n2026-04-04");
    await hours.getByRole("button", { name: "Enregistrer les heures ouvrables" }).click();
    await expect(page.getByText("Heures ouvrables et jours fériés enregistrés.")).toBeVisible();
    await hours.getByLabel("Jours fériés").fill("2026-02-30");
    await hours.getByRole("button", { name: "Enregistrer les heures ouvrables" }).click();
    await expect(hours.getByText("Vérifiez les champs signalés.")).toBeVisible();

    const reminders = page.getByRole("region", { name: "Relances des vérifications (retours)" });
    await reminders.getByLabel("Seconde relance (heures)").fill("8");
    await reminders.getByRole("button", { name: "Enregistrer les délais de relance" }).click();
    await expect(reminders.getByText("Vérifiez les champs signalés.")).toBeVisible();
    await reminders.getByLabel("Seconde relance (heures)").fill("24");
    await reminders.getByRole("button", { name: "Enregistrer les délais de relance" }).click();
    await expect(page.getByText("Délais de relance enregistrés.")).toBeVisible();

    expect((await page.request.get("/medias/retours/abc/photo-0b6c1c55-6f9c-4b0b-9a43-5b3f0e4f7d11.png")).status()).toBe(404);
  });
});
