import { expect, test, type Page } from "@playwright/test";
import { grantRole } from "./support/db";
import { signUp, uniqueEmail } from "./support/flows";

const MAX_SLIDES = 10;

/** Supprime l'annonce portant ce texte (confirmation navigateur) ; sans effet si elle n'existe plus. */
async function removeAnnouncement(page: Page, text: string): Promise<void> {
  await page.goto("/admin/annonces");
  const row = page.locator("article").filter({ has: page.locator(`input[value="${text}"]`) });
  if ((await row.count()) === 0) return;
  page.once("dialog", (dialog) => void dialog.accept());
  await row.getByRole("button", { name: "Supprimer" }).click();
  await expect(row).toHaveCount(0);
}

test.describe("bandeau d'annonces", () => {
  test("l'administrateur principal publie une promotion visible au-dessus de l'en-tête, puis la supprime", async ({ page, browser }) => {
    const text = `Promo E2E ${Math.random().toString(36).slice(2, 8)}`;
    const email = uniqueEmail("e2e-annonces");
    await signUp(page, email, "Administrateur principal E2E");
    await grantRole(email, "SUPER_ADMIN");

    try {
      await page.goto("/admin/annonces");
      await expect(page.getByRole("heading", { level: 1, name: "Annonces" })).toBeVisible();
      const addForm = page.locator("form").filter({ has: page.getByRole("button", { name: "Ajouter l'annonce" }) });
      await addForm.getByLabel("Texte").fill(text);
      await addForm.getByLabel("Lien").fill("/produits");
      await addForm.getByLabel("Type").selectOption("PROMOTION");
      await addForm.getByRole("button", { name: "Ajouter l'annonce" }).click();
      await expect(page.getByText("Annonce ajoutée.")).toBeVisible();

      const visitor = await browser.newPage();
      try {
        await visitor.goto("/");
        const bar = visitor.getByRole("region", { name: "Annonces et promotions" });
        await expect(bar).toBeVisible();
        // D'autres annonces (autres tests) peuvent précéder la nôtre : on avance à la main, de façon bornée.
        const next = bar.getByRole("button", { name: "Annonce suivante" });
        for (let step = 0; step < MAX_SLIDES && !(await bar.getByText(text).isVisible()); step += 1) {
          if ((await next.count()) === 0) break;
          await next.click();
        }
        await expect(bar).toContainText(text);
        await expect(bar).toContainText("Promo");
        const barBox = await bar.boundingBox();
        const headerBox = await visitor.locator("header").first().boundingBox();
        expect(barBox!.y).toBeLessThan(headerBox!.y + 1);
      } finally {
        await visitor.close();
      }
    } finally {
      await removeAnnouncement(page, text);
    }
  });

  test("un administrateur n'a pas le lien « Annonces » et est refusé sur la page", async ({ page }) => {
    const email = uniqueEmail("e2e-annonces-admin");
    await signUp(page, email, "Administrateur E2E");
    await grantRole(email, "ADMIN");
    await page.goto("/admin");
    await expect(page.getByRole("navigation", { name: "Administration" })).toBeVisible();
    await expect(page.getByRole("link", { name: "Annonces" })).toHaveCount(0);
    await page.goto("/admin/annonces");
    await expect(page).toHaveURL(/\/acces-refuse/);
  });
});
