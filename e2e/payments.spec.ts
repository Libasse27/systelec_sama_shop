import { expect, test, type Page } from "@playwright/test";
import { createTestProduct, grantRole, hideTestCategory, stockOf } from "./support/db";
import { addToCart, signUp, uniqueEmail } from "./support/flows";

/** Commande invitée en retrait ; renvoie son numéro et l'URL de suivi (avec jeton). */
async function guestPickupOrder(page: Page, slug: string): Promise<{ number: string; trackingUrl: string }> {
  await addToCart(page, slug, 1);
  await page.goto("/commande");
  await page.getByLabel("Nom complet").fill("Moussa Ndiaye");
  await page.getByLabel("Téléphone").fill("76 555 44 33");
  await page.getByLabel(/Retrait gratuit — \[DÉMO\] Boutique/).check();
  await page.getByRole("button", { name: "Confirmer la commande" }).click();
  await expect(page).toHaveURL(/\/commande\/CMD-\d{4}-\d{6}\?jeton=/);
  const number = (await page.getByRole("heading", { level: 1 }).textContent())!.replace("Commande ", "").trim();
  return { number, trackingUrl: page.url() };
}

async function setStatus(staff: Page, label: string, message: string): Promise<void> {
  const button = staff.getByRole("button", { name: label, exact: true });
  await expect(button).toBeEnabled();
  await button.click();
  await expect(staff.getByText(message)).toBeVisible();
}

test.describe("encaissements en espèces (§20 n° 15, 16 et 26)", () => {
  const categories: string[] = [];
  test.afterAll(async () => {
    for (const id of categories) await hideTestCategory(id);
  });

  test("payée avant remise : encaissement, reçu PDF pour le personnel et l'invité, contre-écriture", async ({ page, browser }) => {
    const product = await createTestProduct({ price: 15_000, onHand: 2 });
    categories.push(product.categoryId);
    const { number, trackingUrl } = await guestPickupOrder(page, product.slug);

    const staff = await browser.newPage();
    const email = uniqueEmail("e2e-caisse");
    await signUp(staff, email, "Caissier E2E");
    await grantRole(email, "ORDER_MANAGER");
    await grantRole(email, "FINANCE_MANAGER");
    await staff.goto(`/admin/commandes?q=${number}`);
    await staff.getByRole("link", { name: number }).click();
    await expect(staff.getByText("Confirmez la commande avant d'encaisser.")).toBeVisible();
    await setStatus(staff, "Confirmée", "Commande passée à « Confirmée ».");
    await setStatus(staff, "En préparation", "Commande passée à « En préparation ».");
    await setStatus(staff, "Prête au retrait", "Commande passée à « Prête au retrait ».");

    // Remise refusée tant que la commande n'est pas soldée.
    staff.once("dialog", (dialog) => dialog.accept());
    await staff.getByRole("button", { name: "Remise au client", exact: true }).click();
    await expect(staff.getByText(/Commande non soldée/)).toBeVisible();

    // Encaissement du solde (prérempli) : reçu numéroté.
    staff.once("dialog", (dialog) => dialog.accept());
    await staff.getByRole("button", { name: "Enregistrer l'encaissement" }).click();
    await expect(staff.getByText(/Encaissement enregistré : reçu REC-\d{4}-\d{6}\./)).toBeVisible();
    await expect(staff.getByText("Commande soldée.")).toBeVisible();
    const receipt = (await staff.getByText(/Encaissement enregistré/).textContent())!.match(/REC-\d{4}-\d{6}/)![0];

    const pdf = await staff.request.get(`/recus/${receipt}`);
    expect(pdf.status()).toBe(200);
    expect(pdf.headers()["content-type"]).toBe("application/pdf");
    expect((await pdf.body()).subarray(0, 5).toString()).toBe("%PDF-");

    // L'invité voit son reçu depuis son lien de suivi ; sans jeton, rien.
    await page.goto(trackingUrl);
    const link = page.getByRole("link", { name: `Reçu ${receipt} (PDF)` });
    await expect(link).toBeVisible();
    expect((await page.request.get((await link.getAttribute("href"))!)).status()).toBe(200);
    expect((await page.request.get(`/recus/${receipt}`)).status()).toBe(404);

    // Contre-écriture : la commande redevient non payée, le reçu d'origine reste.
    await staff.getByLabel(`Motif d'annulation de ${receipt}`).fill("Erreur de saisie E2E");
    staff.once("dialog", (dialog) => dialog.accept());
    await staff.getByRole("button", { name: "Annuler l'encaissement" }).click();
    await expect(staff.getByText(/Encaissement annulé par la contre-écriture REC-/)).toBeVisible();
    await expect(staff.getByText(`annulé par REC-`, { exact: false })).toBeVisible();

    // Nouvel encaissement, puis remise : la vente sort le stock.
    await staff.reload();
    staff.once("dialog", (dialog) => dialog.accept());
    await staff.getByRole("button", { name: "Enregistrer l'encaissement" }).click();
    await expect(staff.getByText(/Encaissement enregistré : reçu/)).toBeVisible();
    staff.once("dialog", (dialog) => dialog.accept());
    await setStatus(staff, "Remise au client", "Commande passée à « Remise au client ».");
    expect(await stockOf(product.sku)).toEqual({ onHand: 1, reserved: 0 });

    // Journal de caisse du jour.
    await staff.goto("/admin/encaissements");
    await expect(staff.getByRole("link", { name: receipt })).toBeVisible();
    await staff.close();
  });

  test("un gestionnaire de commandes ne peut ni encaisser ni annuler un encaissement", async ({ page, browser }) => {
    const product = await createTestProduct({ price: 9_000, onHand: 1 });
    categories.push(product.categoryId);
    const { number } = await guestPickupOrder(page, product.slug);

    const staff = await browser.newPage();
    const email = uniqueEmail("e2e-gestion");
    await signUp(staff, email, "Gestionnaire E2E");
    await grantRole(email, "ORDER_MANAGER");
    await staff.goto(`/admin/commandes?q=${number}`);
    await staff.getByRole("link", { name: number }).click();
    await setStatus(staff, "Confirmée", "Commande passée à « Confirmée ».");
    await expect(staff.getByRole("heading", { name: "Encaissements" })).toBeVisible(); // lecture seule (payments.read)
    await expect(staff.getByRole("button", { name: "Enregistrer l'encaissement" })).toHaveCount(0);
    await staff.goto("/admin/encaissements");
    await expect(staff.getByRole("heading", { name: "Encaissements" })).toBeVisible();
    await staff.close();
  });
});
