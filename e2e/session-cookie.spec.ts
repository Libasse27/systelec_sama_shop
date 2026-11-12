import { expect, test, type BrowserContext, type Cookie } from "@playwright/test";
import { signUp, uniqueEmail } from "./support/flows";

/**
 * Référence avant toute montée de version de Better Auth : attributs du cookie de session tels
 * qu'émis aujourd'hui (src/server/auth/auth.ts). En E2E, APP_ENV vaut « test » et le serveur est
 * servi en http : Secure et le préfixe __Secure- (actifs seulement si APP_ENV=production) ne
 * peuvent pas être vérifiés ici.
 */
const SESSION_COOKIE = "better-auth.session_token";
const SESSION_DAYS = 7; // session.expiresIn, src/server/auth/auth.ts
const DAY_SECONDS = 24 * 60 * 60;

const sessionCookie = async (context: BrowserContext): Promise<Cookie | undefined> =>
  (await context.cookies()).find((cookie) => cookie.name === SESSION_COOKIE && cookie.value !== "");

test.describe("cookie de session", () => {
  test.beforeEach(({}, testInfo) => {
    test.skip(testInfo.project.name !== "desktop", "Attributs émis par le serveur : vérifiés sur le profil bureau uniquement.");
  });

  test("après inscription : HttpOnly, SameSite Lax, Path /, expiration à 7 jours", async ({ page, context }) => {
    await signUp(page, uniqueEmail("e2e-cookie"));

    const cookie = await sessionCookie(context);
    expect(cookie).toBeDefined();
    expect(cookie).toMatchObject({ httpOnly: true, sameSite: "Lax", path: "/", secure: false });
    const expected = Date.now() / 1000 + SESSION_DAYS * DAY_SECONDS;
    expect(Math.abs(cookie!.expires - expected)).toBeLessThan(DAY_SECONDS);
  });

  test("la déconnexion supprime le cookie de session", async ({ page, context }) => {
    await signUp(page, uniqueEmail("e2e-cookie"));
    expect(await sessionCookie(context)).toBeDefined();

    await page.getByRole("button", { name: "Se déconnecter" }).click();
    await expect(page).toHaveURL(/\/$/);
    expect(await sessionCookie(context)).toBeUndefined();
  });
});
