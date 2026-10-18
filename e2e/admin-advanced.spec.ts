import { expect, test, type Page } from "@playwright/test";
import { createTestProduct, grantRole, hideTestCategory, stockOf } from "./support/db";
import { addToCart, signUp, uniqueEmail } from "./support/flows";

const unique = () => `${Date.now()}${Math.random().toString(36).slice(2, 6)}`;

/** Commande invitée ; renvoie son numéro et l'URL de suivi (avec jeton). */
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

/** Membre du personnel connecté dans un nouvel onglet, avec les rôles donnés. */
async function staffPage(page: Page, roles: string[], name = "Personnel E2E"): Promise<{ email: string }> {
  const email = uniqueEmail("e2e-p9");
  await signUp(page, email, name);
  for (const role of roles) await grantRole(email, role);
  return { email };
}

/** Clique un bouton (avec confirmation éventuelle) et attend le message de succès. */
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

test.describe("administration avancée (phase 9)", () => {
  const categories: string[] = [];
  test.afterAll(async () => {
    for (const id of categories) await hideTestCategory(id);
  });

  test("retour et remboursement en espèces, facture de la commande, suivi par l'invité", async ({ page, browser }) => {
    test.setTimeout(90_000);
    const product = await createTestProduct({ price: 15_000, onHand: 5 });
    categories.push(product.categoryId);
    const { number, trackingUrl } = await guestOrder(page, product.slug, "PICKUP");

    const staff = await browser.newPage();
    await staffPage(staff, ["ORDER_MANAGER", "FINANCE_MANAGER"], "Gestion E2E");
    await openOrder(staff, number);
    await submit(staff, "Confirmée", "Commande passée à « Confirmée ».");
    await submit(staff, "Enregistrer l'encaissement", /Encaissement enregistré : reçu REC-/, true);
    await submit(staff, "En préparation", "Commande passée à « En préparation ».");
    await submit(staff, "Prête au retrait", "Commande passée à « Prête au retrait ».");
    await submit(staff, "Remise au client", "Commande passée à « Remise au client ».", true);
    expect(await stockOf(product.sku)).toEqual({ onHand: 3, reserved: 0 });

    // Facture unique et figée.
    await submit(staff, "Émettre la facture", /Facture FAC-\d{4}-\d{6} émise\./, true);
    const invoice = (await staff.getByText(/Facture FAC-\d{4}-\d{6} émise/).textContent())!.match(/FAC-\d{4}-\d{6}/)![0];
    const pdf = await staff.request.get(`/factures/${invoice}`);
    expect(pdf.status()).toBe(200);
    expect((await pdf.body()).subarray(0, 5).toString()).toBe("%PDF-");

    // Retour d'un article déclaré au nom du client : à vérifier.
    await staff.getByLabel(/Quantité retournée/).fill("1");
    await staff.getByLabel("Motif du client").fill("Ne convient pas");
    await submit(staff, "Enregistrer le retour", /Retour RET-\d{4}-\d{6} enregistré : à vérifier\./);
    const returnNumber = (await staff.getByText(/Retour RET-\d{4}-\d{6} enregistré/).textContent())!.match(/RET-\d{4}-\d{6}/)![0];
    await staff.getByRole("link", { name: returnNumber }).click();
    await expect(staff.getByRole("heading", { name: `Retour ${returnNumber}` })).toBeVisible();
    // Validation indépendante : la personne qui a déclaré ne peut pas décider.
    await expect(staff.getByText("Vous avez déclaré ce retour : un autre responsable doit l'accepter ou le refuser")).toBeVisible();
    await expect(staff.getByRole("button", { name: "Accepter le retour" })).toHaveCount(0);
    const returnUrl = staff.url();

    // Un second responsable demande des photos, enregistre la réponse, puis accepte.
    const reviewer = await browser.newPage();
    await staffPage(reviewer, ["ORDER_MANAGER"], "Responsable retours E2E");
    await reviewer.goto(returnUrl);
    await reviewer.getByLabel("Nature de la vérification").selectOption({ label: "Photos" });
    await reviewer.getByLabel("Précisions demandées").fill("Photos de l'article et de l'emballage");
    await submit(reviewer, "Demander la vérification", "Vérification demandée.");
    await expect(reviewer.getByText("Vérification demandée").first()).toBeVisible();
    await reviewer.getByLabel("Réponse ou résultat de la vérification").fill("Photos reçues : article intact, emballage d'origine");
    await submit(reviewer, "Enregistrer la réponse", "Réponse à la vérification enregistrée.");
    await reviewer.getByLabel("Motif de la décision").fill("Article intact, emballage d'origine");
    await submit(reviewer, "Accepter le retour", "Retour accepté.", true);
    expect(await stockOf(product.sku)).toEqual({ onHand: 4, reserved: 0 });
    // Jamais versé automatiquement : le remboursement attend la validation des finances.
    await expect(reviewer.getByText("Remboursement à valider et verser par une personne autorisée (finances).")).toBeVisible();
    const overflow = await reviewer.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
    expect(overflow).toBeLessThanOrEqual(0);
    await reviewer.close();

    // Les finances valident et versent le remboursement ; l'historique du retour est complet.
    await staff.reload();
    await submit(staff, /^Rembourser .+ en espèces$/, /Remboursement versé : reçu REC-/, true);
    const history = staff.getByRole("region", { name: "Historique du retour" });
    for (const step of ["Retour déclaré", "Vérification demandée", "Réponse à la vérification", "Retour accepté", "Remboursement versé"]) {
      await expect(history.getByText(step, { exact: true })).toBeVisible();
    }
    await expect(history.getByText(/Responsable retours E2E/).first()).toBeVisible();
    await staff.goto(`/admin/commandes?q=${number}`);
    await staff.getByRole("link", { name: number }).click();
    await expect(staff.getByText("Remboursement effectué").first()).toBeVisible();
    await expect(staff.getByText(/remboursement du retour RET-/).first()).toBeVisible();

    // Journal de caisse : le remboursement est distingué des annulations.
    await staff.goto("/admin/retours?statut=COMPLETED");
    await expect(staff.getByRole("link", { name: number })).toBeVisible();
    await staff.close();

    // L'invité voit sa facture et son remboursement ; sans jeton, rien.
    await page.goto(trackingUrl);
    await expect(page.getByText(/remboursement de .+ en espèces/)).toBeVisible();
    const invoiceLink = page.getByRole("link", { name: `Facture ${invoice} (PDF)` });
    await expect(invoiceLink).toBeVisible();
    expect((await page.request.get((await invoiceLink.getAttribute("href"))!)).status()).toBe(200);
    expect((await page.request.get(`/factures/${invoice}`)).status()).toBe(404);
  });

  test("livraison détaillée : livreur, départ, encaissement par le livreur, preuve de livraison", async ({ page, browser }) => {
    test.setTimeout(90_000);
    const product = await createTestProduct({ price: 10_000, onHand: 4 });
    categories.push(product.categoryId);
    const { number } = await guestOrder(page, product.slug, "DELIVERY");

    const staff = await browser.newPage();
    await staffPage(staff, ["ORDER_MANAGER", "DELIVERY_MANAGER"], "Livraisons E2E");
    const courier = `Livreur E2E ${unique()}`;
    await staff.goto("/admin/livraison");
    const couriers = staff.getByRole("region", { name: "Livreurs" });
    await couriers.getByLabel("Nom du livreur").last().fill(courier);
    await couriers.getByLabel("Téléphone").last().fill("77 000 00 00");
    await couriers.getByRole("button", { name: "Ajouter le livreur" }).click();
    await expect(staff.getByText("Livreur ajouté.")).toBeVisible();

    await openOrder(staff, number);
    await submit(staff, "Confirmée", "Commande passée à « Confirmée ».");
    await staff.getByLabel("Livreur", { exact: true }).selectOption({ label: `${courier} (0 en cours)` });
    await submit(staff, "Assigner le livreur", "Livreur assigné.");
    await submit(staff, "En préparation", "Commande passée à « En préparation ».");
    await submit(staff, "Prête à livrer", "Commande passée à « Prête à livrer ».");
    // Décision 5 : une commande à livrer n'est jamais remise à la main.
    await expect(staff.getByRole("button", { name: "Remise au client", exact: true })).toHaveCount(0);
    await expect(staff.getByText("Commande à livrer : elle est remise au client uniquement par un livreur")).toBeVisible();
    await submit(staff, "Départ en livraison", "Départ en livraison enregistré.");
    await expect(staff.getByText("En cours de livraison").first()).toBeVisible();

    // Non soldée : la livraison n'est pas validée.
    await staff.getByLabel("Reçue par").fill("Mariama Ba");
    staff.once("dialog", (dialog) => dialog.accept());
    await staff.getByRole("button", { name: "Marquer livrée" }).click();
    await expect(staff.getByText(/Commande non soldée/)).toBeVisible();

    // Le livreur encaisse, puis la livraison est marquée effectuée : commande remise, stock sorti.
    await submit(staff, "Enregistrer l'encaissement", /Encaissement enregistré : reçu REC-/, true);
    await staff.getByLabel("Reçue par").fill("Mariama Ba");
    await staff.getByLabel("Observations").fill("Remis en main propre");
    await submit(staff, "Marquer livrée", "Livraison effectuée : commande remise au client.", true);
    await staff.reload();
    await expect(staff.getByText("Remise au client").first()).toBeVisible();
    await expect(staff.getByText(/reçue par Mariama Ba/)).toBeVisible();
    expect(await stockOf(product.sku)).toEqual({ onHand: 2, reserved: 0 });

    await staff.goto("/admin/livraisons?statut=DELIVERED");
    await expect(staff.getByRole("link", { name: number })).toBeVisible();
    await staff.close();
  });

  test("utilisateurs et rôles : attribution, retrait, désactivation, pas d'auto-rétrogradation, audit", async ({ page, browser }) => {
    test.setTimeout(90_000);
    const target = uniqueEmail("e2e-cible");
    await signUp(page, target, "Cible E2E");

    const admin = await browser.newPage();
    const { email: adminEmail } = await staffPage(admin, ["ADMIN"], "Administrateur E2E");
    await admin.goto(`/admin/utilisateurs?q=${encodeURIComponent(target)}`);
    await admin.getByRole("link", { name: "Cible E2E" }).click();
    await admin.getByLabel("Attribuer un rôle").selectOption({ label: "Gestionnaire de stock" });
    await submit(admin, "Attribuer", "Rôle « Gestionnaire de stock » attribué.", true);
    await submit(admin, "Retirer « Gestionnaire de stock »", "Rôle « Gestionnaire de stock » retiré.", true);
    await admin.getByLabel("Motif").fill("Compte de test E2E");
    await submit(admin, "Désactiver le compte", "Compte désactivé : ses sessions sont fermées.", true);

    // Le compte désactivé perd sa session.
    await page.goto("/compte");
    await expect(page).toHaveURL(/\/connexion/);

    // Journal d'audit de ce compte.
    await admin.getByRole("link", { name: /Historique de ce compte/ }).click();
    await expect(admin.getByText("rbac.role.assign")).toBeVisible();
    await expect(admin.getByText("user.deactivate")).toBeVisible();

    // Sa propre fiche : ni retrait de ses rôles ni désactivation.
    await admin.goto(`/admin/utilisateurs?q=${encodeURIComponent(adminEmail)}`);
    await admin.getByRole("link", { name: "Administrateur E2E" }).click();
    await expect(admin.getByText("Vous ne pouvez pas désactiver votre propre compte.")).toBeVisible();
    await expect(admin.getByRole("button", { name: /^Retirer/ })).toHaveCount(0);
    await admin.close();
  });

  test("paramètres (D7) et contenu : mentions légales, page publiée, audit", async ({ page }) => {
    await staffPage(page, ["ADMIN"], "Paramètres E2E");
    const ninea = `E2E${unique()}`.slice(0, 20);
    await page.goto("/admin/parametres");
    await page.getByLabel("NINEA").fill(ninea);
    await submit(page, "Enregistrer l'identité", "Identité et mentions légales enregistrées.");
    // Valeur invalide : refusée, rattachée au champ.
    await page.getByLabel("Durée de réservation du stock (heures)", { exact: false }).fill("0");
    await page.getByRole("button", { name: "Enregistrer les règles de commande" }).click();
    await expect(page.getByText("Vérifiez les champs signalés.")).toBeVisible();

    const slug = `page-e2e-${unique()}`;
    await page.goto("/admin/contenu");
    const pages = page.getByRole("region", { name: "Pages d'information" });
    await pages.getByLabel("Titre").last().fill("Page de test E2E");
    await pages.getByLabel("Adresse (/pages/…)").last().fill(slug);
    await pages.getByLabel("Texte").last().fill("Premier paragraphe de la page de test.\n\nSecond paragraphe.");
    await pages.getByLabel("Publiée (visible par tous)").last().check();
    await submit(page, "Créer la page", "Page créée.");
    await page.goto(`/pages/${slug}`);
    await expect(page.getByRole("heading", { name: "Page de test E2E" })).toBeVisible();

    await page.goto(`/admin/audit?action=settings.update&acteur=${encodeURIComponent("Paramètres E2E")}`);
    await expect(page.getByText("settings.update").first()).toBeVisible();
  });

  test("partenaires (décision 4) : logo téléversé, affichage sur l'accueil, désactivation ; aucun logo externe", async ({ page }) => {
    await staffPage(page, ["ADMIN"], "Partenaires E2E");
    // Le logo du site ne se saisit plus par adresse externe.
    await page.goto("/admin/parametres");
    await expect(page.getByLabel(/Adresse d'un logo/)).toHaveCount(0);

    const name = `Partenaire E2E ${unique()}`;
    const png = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 0]);
    await page.goto("/admin/contenu");
    const partners = page.getByRole("region", { name: "Partenaires" });
    await partners.getByLabel("Nom du partenaire").last().fill(name);
    await partners.getByLabel(/Site du partenaire/).last().fill("http://non-securise.example");
    await partners.getByLabel("Logo du partenaire").setInputFiles({ name: "logo.png", mimeType: "image/png", buffer: png });
    await partners.getByRole("button", { name: "Ajouter le partenaire" }).click();
    await expect(page.getByText("Adresse https:// requise")).toBeVisible();
    await partners.getByLabel(/Site du partenaire/).last().fill("https://partenaire.example");
    await partners.getByLabel("Logo du partenaire").setInputFiles({ name: "logo.png", mimeType: "image/png", buffer: png });
    await submit(page, "Ajouter le partenaire", "Partenaire ajouté.");

    await page.goto("/");
    const logo = page.getByRole("img", { name, exact: true });
    await expect(page.getByRole("heading", { name: "Nos partenaires" })).toBeVisible();
    await expect(logo).toHaveAttribute("src", /^\/medias\/partenaires\/partenaire-[a-f0-9-]{36}\.png$/);
    await expect(page.getByRole("link", { name })).toHaveAttribute("href", "https://partenaire.example");

    // Désactivé : retiré de la boutique.
    await page.goto("/admin/contenu");
    await partners.getByText(name).click();
    const form = partners.locator("details", { hasText: name });
    await form.getByLabel("Actif (affiché sur la boutique)").uncheck();
    await form.getByRole("button", { name: "Enregistrer le partenaire" }).click();
    await expect(page.getByText("Partenaire enregistré.")).toBeVisible();
    await page.goto("/");
    await expect(page.getByRole("img", { name, exact: true })).toHaveCount(0);
  });

  test("rapports financiers et exports CSV, Excel et PDF ; tableau de bord selon le rôle", async ({ page, browser }) => {
    await staffPage(page, ["FINANCE_MANAGER"], "Finances E2E");
    await page.goto("/admin");
    await expect(page.getByRole("heading", { name: "Caisse du jour" })).toBeVisible();
    await expect(page.getByRole("heading", { name: "Ventes remises au client" })).toBeVisible();
    await expect(page.getByRole("heading", { name: "Alertes de stock" })).toHaveCount(0);

    await page.goto("/admin/rapports");
    await expect(page.getByText("Net en caisse (espèces)")).toBeVisible();
    const exports = [
      ["csv", "text/csv; charset=utf-8", "﻿Date;"],
      ["xlsx", "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet", "PK"],
      ["pdf", "application/pdf", "%PDF-"],
    ] as const;
    for (const [format, contentType, start] of exports) {
      const href = await page.getByRole("link", { name: new RegExp(`Exporter en ${format === "csv" ? "CSV" : format === "xlsx" ? "Excel" : "PDF"}`) }).getAttribute("href");
      const response = await page.request.get(href!);
      expect(response.status()).toBe(200);
      expect(response.headers()["content-type"]).toBe(contentType);
      expect(response.headers()["content-disposition"]).toMatch(/^attachment; filename="rapport-financier-/);
      expect((await response.body()).toString("utf8").startsWith(start)).toBe(true);
    }
    expect((await page.request.get("/admin/rapports/export?format=xlsx&du=2026-02-30")).status()).toBe(400);

    // Un gestionnaire de stock (reports.read sans payments.read) n'accède pas aux rapports financiers.
    const stock = await browser.newPage();
    await staffPage(stock, ["STOCK_MANAGER"], "Stock E2E");
    await stock.goto("/admin/rapports");
    await expect(stock).toHaveURL(/\/acces-refuse/);
    expect((await stock.request.get("/admin/rapports/export?format=csv")).status()).toBe(403);
    await stock.goto("/admin");
    await expect(stock.getByRole("heading", { name: "Alertes de stock" })).toBeVisible();
    await expect(stock.getByRole("heading", { name: "Caisse du jour" })).toHaveCount(0);
    await stock.close();
  });
});

test("les écrans d'administration de la phase 9 ne débordent pas horizontalement", async ({ page }) => {
  await staffPage(page, ["ADMIN"], "Affichage E2E");
  for (const path of ["/admin", "/admin/utilisateurs", "/admin/livraisons", "/admin/retours", "/admin/rapports", "/admin/contenu", "/admin/parametres", "/admin/audit"]) {
    await page.goto(path);
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
    expect(overflow, path).toBeLessThanOrEqual(0);
  }
});
