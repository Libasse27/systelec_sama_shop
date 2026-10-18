import { expect, test, type Page } from "@playwright/test";
import { grantRole } from "./support/db";
import { signUp, uniqueEmail } from "./support/flows";

const accept = (page: Page) => page.once("dialog", (dialog) => dialog.accept());

async function staffAccount(page: Page, name: string, roles: string[]): Promise<void> {
  const email = uniqueEmail("e2e-tech");
  await signUp(page, email, name);
  for (const role of roles) await grantRole(email, role);
}

async function click(page: Page, button: string, message: string | RegExp, confirm = false): Promise<void> {
  const target = page.getByRole("button", { name: button, exact: true });
  await expect(target).toBeEnabled();
  if (confirm) accept(page);
  await target.click();
  await expect(page.getByText(message).first()).toBeVisible();
}

test.describe("services techniques (§20 n° 19, 20 et 21)", () => {
  // Parcours complet à trois acteurs (client, responsable, technicien).
  test.setTimeout(90_000);

  test("demande invitée → devis → acceptation → planning → intervention → encaissement et facture", async ({ page, browser }) => {
    const suffix = Math.random().toString(36).slice(2, 8);
    const techName = `Technicien ${suffix}`;

    // 1. Le client (invité) dépose sa demande depuis la fiche du service.
    await page.goto("/devis/demande?service=installation-de-cameras");
    await expect(page.getByRole("button", { name: "Envoyer ma demande" })).toBeEnabled();
    await page.getByLabel("Nom complet").fill("Fatou Sow");
    await page.getByLabel("Téléphone").fill("78 222 33 44");
    await page.getByLabel("Adresse de l'intervention").fill("Villa 12, Sacré-Cœur 3, Dakar");
    await page.getByLabel("Votre besoin").fill("Installer quatre caméras autour de la maison avec enregistreur.");
    await page.getByRole("button", { name: "Envoyer ma demande" }).click();
    await expect(page).toHaveURL(/\/devis\/demande\/DDE-\d{4}-\d{6}\?jeton=/);
    await expect(page.getByRole("status")).toContainText("Merci !");
    const requestNumber = (await page.getByRole("heading", { level: 1 }).textContent())!.replace("Demande ", "").trim();
    const requestUrl = page.url();
    expect((await page.request.get(`/devis/demande/${requestNumber}`)).status()).toBe(404);

    // 2. Un technicien et un responsable technique.
    const tech = await browser.newPage();
    await staffAccount(tech, techName, ["TECHNICIAN"]);
    const staff = await browser.newPage();
    await staffAccount(staff, "Responsable technique E2E", ["TECH_MANAGER"]);
    await staff.goto("/admin/techniciens");
    const card = staff.getByRole("listitem").filter({ hasText: techName });
    await card.getByLabel("Zones d'intervention").fill("Dakar");
    await card.getByRole("button", { name: "Enregistrer" }).click();
    await expect(card.getByText("Profil enregistré.")).toBeVisible();

    // 3. Devis détaillé, envoyé au client.
    await staff.goto(`/admin/demandes?q=${requestNumber}`);
    await staff.getByRole("link", { name: requestNumber }).click();
    await expect(staff.getByRole("button", { name: "Créer un devis" })).toBeEnabled();
    await staff.getByRole("button", { name: "Créer un devis" }).click();
    await expect(staff).toHaveURL(/\/admin\/devis\//);
    await staff.getByLabel("Désignation, ligne 1").fill("Caméra IP extérieure");
    await staff.getByLabel("Quantité, ligne 1").fill("4");
    await staff.getByLabel("Prix unitaire, ligne 1").fill("35000");
    await staff.getByLabel("Type, ligne 2").selectOption("LABOR");
    await staff.getByLabel("Désignation, ligne 2").fill("Pose et câblage");
    await staff.getByLabel("Quantité, ligne 2").fill("1");
    await staff.getByLabel("Prix unitaire, ligne 2").fill("40000");
    await click(staff, "Enregistrer et envoyer au client", /Devis envoyé au client \(180\D000 FCFA\)/, true);

    // 4. Le client accepte depuis son lien de suivi.
    await page.goto(requestUrl);
    await page.getByRole("link", { name: /^Devis DEV-/ }).click();
    await expect(page.getByRole("row", { name: /Total TTC/ })).toContainText("180");
    await click(page, "Accepter le devis", /Merci, devis accepté/, true);
    const quoteUrl = page.url().replace(/&reponse=[a-z]+/, "");

    // 5. Planification sur le créneau du technicien.
    await staff.reload();
    await staff.getByRole("link", { name: /^intervention INT-/ }).click();
    await staff.getByLabel("Technicien").selectOption({ label: `${techName} (Dakar)` });
    await click(staff, "Planifier", "Intervention planifiée, client notifié.");
    const interventionUrl = staff.url();

    // 6. Le technicien voit SON intervention, la démarre, rédige le rapport, termine.
    await tech.goto("/admin/interventions");
    await expect(tech.getByRole("heading", { name: "Mes interventions" })).toBeVisible();
    await tech.goto(interventionUrl);
    await click(tech, "Démarrer l'intervention", "Intervention démarrée.");
    await tech.getByLabel("Diagnostic").fill("Aucun câblage existant.");
    await tech.getByLabel("Travaux réalisés").fill("Pose de 4 caméras et de l'enregistreur.");
    await tech.getByLabel("Temps passé (minutes)").fill("240");
    await click(tech, "Enregistrer le rapport", "Rapport enregistré.");
    await tech.getByLabel("Désignation").fill("Chevilles");
    await tech.getByLabel("Quantité").fill("20");
    await click(tech, "Ajouter la pièce", "Pièce ajoutée.");
    await tech.getByLabel("Personne présente qui constate la fin des travaux").fill("M. Sow");
    await click(tech, "Terminer l'intervention", "Intervention terminée : elle peut être encaissée.", true);
    // Le technicien n'encaisse pas.
    await expect(tech.getByRole("button", { name: "Enregistrer l'encaissement" })).toHaveCount(0);
    await tech.close();

    // 7. Encaissement en espèces après la prestation, puis facture.
    await staff.reload();
    await click(staff, "Enregistrer l'encaissement", /Encaissement enregistré : reçu REC-/, true);
    await click(staff, "Émettre la facture", /Facture FAC-\d{4}-\d{6} émise\./, true);
    await staff.close();

    // 8. Le client retrouve reçu et facture depuis son lien ; sans jeton, rien.
    await page.goto(quoteUrl);
    await expect(page.getByText("Terminée")).toBeVisible();
    const invoice = page.getByRole("link", { name: /^Facture FAC-/ });
    const receipt = page.getByRole("link", { name: /^Reçu REC-/ });
    for (const link of [invoice, receipt]) {
      const href = (await link.getAttribute("href"))!;
      const response = await page.request.get(href);
      expect(response.status()).toBe(200);
      expect(response.headers()["content-type"]).toBe("application/pdf");
      expect((await page.request.get(href.replace(/\?jeton=.*/, ""))).status()).toBe(404);
    }
  });
});
