import { expect, test } from "@playwright/test";
import { guardCompanySetting, writeCompanySetting, type CompanySettingGuard } from "./support/db";

/**
 * Mention de copyright du pied de page : nom du groupe (marque), jamais la raison sociale
 * (SYSTELEC reste réservée aux factures et aux mentions légales).
 */
test("pied de page : copyright au nom de FUTANI GROUP", async ({ page }) => {
  await page.goto("/");
  const footer = page.getByRole("contentinfo");
  await expect(footer.getByText(`© ${new Date().getFullYear()} FUTANI GROUP. Tous droits réservés.`, { exact: true })).toBeVisible();
  await expect(footer.getByText(/© \d{4} SYSTELEC/)).toHaveCount(0);
});

test("pied de page : bloc Paiement avec les trois moyens acceptés, sans repère de navigation", async ({ page }) => {
  await page.goto("/");
  const footer = page.getByRole("contentinfo");
  await expect(footer.getByRole("heading", { level: 2, name: "Paiement", exact: true })).toBeVisible();
  await expect(footer.getByRole("navigation", { name: "Paiement" })).toHaveCount(0);
  for (const label of ["Espèces", "Orange Money", "Wave"]) {
    await expect(footer.getByRole("listitem").filter({ hasText: label })).toBeVisible();
  }
  await expect(footer.getByText("À la livraison ou au retrait.", { exact: true })).toBeVisible();
});

/**
 * Mentions légales : paramètre « company » partagé par toute la base E2E, donc profil bureau uniquement
 * et verrou commun avec les autres fichiers qui le modifient (valeur d'origine restaurée même en cas d'échec).
 */
test.describe("pied de page : mentions légales", () => {
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

  const company = (legal: { companyName: string; ninea: string | null; rccm: string | null }) => ({
    shopName: "FUTANI SHOP",
    logoUrl: null,
    phone: null,
    whatsapp: null,
    email: null,
    address: null,
    openingHours: null,
    socialLinks: { facebook: null, instagram: null, linkedin: null, tiktok: null, youtube: null, x: null },
    ...legal,
  });

  test("raison sociale toujours affichée, NINEA et RCCM seulement s'ils sont renseignés", async ({ page }) => {
    const footer = page.getByRole("contentinfo");

    // Sans paramètre enregistré : raison sociale par défaut, aucune mention vide.
    await writeCompanySetting(null);
    await page.goto("/");
    await expect(footer.getByText("Raison sociale : SYSTELEC", { exact: true })).toBeVisible();
    await expect(footer.getByText(/NINEA|RCCM/)).toHaveCount(0);

    await writeCompanySetting(company({ companyName: "Société E2E", ninea: "0012345 2G3", rccm: null }));
    await page.goto("/");
    await expect(footer.getByText("Raison sociale : Société E2E · NINEA : 0012345 2G3", { exact: true })).toBeVisible();
    await expect(footer.getByText(/RCCM/)).toHaveCount(0);

    await writeCompanySetting(company({ companyName: "Société E2E", ninea: "0012345 2G3", rccm: "SN-DKR-2026-B-1234" }));
    await page.goto("/");
    await expect(footer.getByText("Raison sociale : Société E2E · NINEA : 0012345 2G3 · RCCM : SN-DKR-2026-B-1234", { exact: true })).toBeVisible();
    await expect(footer.getByText(`© ${new Date().getFullYear()} FUTANI GROUP. Tous droits réservés.`, { exact: true })).toBeVisible();
  });

  test("valeurs saisies affichées en texte brut, jamais interprétées comme du HTML", async ({ page }) => {
    await writeCompanySetting(company({ companyName: "Société <b>E2E</b>", ninea: null, rccm: null }));
    await page.goto("/");
    const footer = page.getByRole("contentinfo");
    await expect(footer.getByText("Raison sociale : Société <b>E2E</b>", { exact: true })).toBeVisible();
    await expect(footer.locator("b")).toHaveCount(0);
  });
});
