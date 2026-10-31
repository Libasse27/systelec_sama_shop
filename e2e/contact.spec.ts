import { expect, test } from "@playwright/test";
import { grantRole } from "./support/db";
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
