import { expect, test } from "@playwright/test";

/**
 * Connexion sociale (clients uniquement). Le serveur E2E reçoit de FAUX identifiants Google et Microsoft
 * (playwright.config.ts) : Facebook et Apple restent affichés mais désactivés (« Bientôt disponible »).
 * Aucun appel n'atteint les fournisseurs : la page d'autorisation Google est interceptée.
 */
test.describe("connexion sociale", () => {
  test.beforeEach(({}, testInfo) => {
    test.skip(testInfo.project.name !== "desktop", "Surface HTTP et redirections : vérifiées sur le profil bureau uniquement.");
  });

  for (const path of ["/connexion", "/inscription"]) {
    test(`${path} : les 4 fournisseurs affichés, seuls les configurés actifs, cibles d'au moins 44 px`, async ({ page }) => {
      await page.goto(path);
      const section = page.getByRole("region", { name: "Ou continuer avec" });
      const buttons = section.getByRole("button");
      await expect(buttons).toHaveCount(4);
      const names = await buttons.evaluateAll((elements) =>
        elements.map((element) => element.getAttribute("aria-label") ?? element.textContent?.trim() ?? ""),
      );
      expect(names.map((name) => name.split(" (")[0])).toEqual([
        "Continuer avec Google",
        "Continuer avec Facebook",
        "Continuer avec Apple",
        "Continuer avec Microsoft",
      ]);

      for (const name of ["Continuer avec Google", "Continuer avec Microsoft"]) {
        const button = section.getByRole("button", { name, exact: true });
        await expect(button).toBeEnabled();
        await expect(button).toHaveAttribute("type", "submit");
      }
      for (const name of ["Continuer avec Facebook (bientôt disponible)", "Continuer avec Apple (bientôt disponible)"]) {
        const button = section.getByRole("button", { name, exact: true });
        await expect(button).toBeVisible();
        await expect(button).toBeDisabled();
        await expect(button).toHaveAttribute("aria-disabled", "true");
        await expect(button).toHaveAttribute("type", "button");
        await expect(button).toContainText("Bientôt disponible");
        // Aucun formulaire ni champ caché : rien ne peut partir vers l'action serveur.
        expect(await button.evaluate((element) => element.closest("form"))).toBeNull();
        await button.click({ force: true });
        await expect(page).toHaveURL(new RegExp(`${path}$`));
      }
      await expect(section.locator("form")).toHaveCount(2);
      await expect(section.locator('input[name="provider"][value="facebook"], input[name="provider"][value="apple"]')).toHaveCount(0);

      for (const button of await buttons.all()) {
        expect((await button.boundingBox())?.height ?? 0).toBeGreaterThanOrEqual(44);
      }
    });
  }

  test("« Continuer avec Google » redirige vers Google avec état, PKCE et notre route de retour", async ({ page }) => {
    let authorization: URL | undefined;
    await page.route("https://accounts.google.com/**", async (route) => {
      authorization = new URL(route.request().url());
      await route.fulfill({ status: 200, contentType: "text/html", body: "<p>Google simulé</p>" });
    });
    await page.goto("/connexion?suivant=%2Fpanier");
    await page.getByRole("button", { name: "Continuer avec Google", exact: true }).click();

    await expect.poll(() => authorization?.origin).toBe("https://accounts.google.com");
    const params = authorization!.searchParams;
    // Origine = APP_URL du serveur E2E (lue dans .env), pas forcément le port de test : seul le chemin est vérifié.
    expect(new URL(params.get("redirect_uri") ?? "").pathname).toBe("/api/auth/callback/google");
    expect(params.get("response_type")).toBe("code");
    expect(params.get("state")).toBeTruthy();
    expect(params.get("code_challenge")).toBeTruthy();
    expect(params.get("code_challenge_method")).toBe("S256");
    expect(params.get("client_id")).toBe("e2e-google-client");
  });

  const notFound: ReadonlyArray<readonly [string, string]> = [
    ["POST", "/api/auth/sign-in/email"],
    ["GET", "/api/auth/get-session"],
    ["POST", "/api/auth/sign-in/social"],
    ["GET", "/api/auth/error"],
    ["GET", "/api/auth/callback/github"],
    ["GET", "/api/auth/callback/facebook"],
    ["POST", "/api/auth/callback/google"],
  ];
  for (const [method, path] of notFound) {
    test(`${method} ${path} : 404 (seul le retour d'un fournisseur actif est exposé)`, async ({ request }) => {
      const response = await request.fetch(path, { method, data: method === "POST" ? {} : undefined, maxRedirects: 0 });
      expect(response.status()).toBe(404);
    });
  }

  test("GET /api/auth/callback/google sans état : renvoi vers la connexion, jamais une page Better Auth", async ({ request }) => {
    const response = await request.get("/api/auth/callback/google?code=x", { maxRedirects: 0 });
    expect(response.status()).toBe(302);
    expect(response.headers()["cache-control"]).toBe("no-store");
    const location = new URL(response.headers()["location"] ?? "", "http://x.invalid");
    expect(location.pathname).toBe("/connexion");
    expect(location.searchParams.get("error")).toBe("state_not_found");
  });

  test("erreur au retour : message français choisi par code, description reçue jamais affichée", async ({ page }) => {
    const injected = "<script>x</script>";
    await page.goto(`/connexion?error=account_not_linked&error_description=${encodeURIComponent(injected)}`);
    await expect(page.getByRole("main").getByRole("alert")).toHaveText(
      "Un compte existe déjà avec cette adresse e-mail. Connectez-vous avec votre e-mail et votre mot de passe.",
    );
    await expect(page.getByText(injected)).toHaveCount(0);
    expect(await page.content()).not.toContain(injected);
  });

  test("/connexion/sociale sans session : renvoi vers la connexion", async ({ request }) => {
    const response = await request.get("/connexion/sociale?suivant=%2Fpanier", { maxRedirects: 0 });
    expect(response.status()).toBe(303);
    expect(response.headers()["location"]).toMatch(/\/connexion\?error=session_missing$/);
  });
});
