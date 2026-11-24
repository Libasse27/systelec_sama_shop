import { describe, expect, it } from "vitest";
import { socialErrorMessage } from "./social-errors";

const EXISTING = "Un compte existe déjà avec cette adresse e-mail. Connectez-vous avec votre e-mail et votre mot de passe.";
const GENERIC = "La connexion n'a pas abouti. Réessayez ou connectez-vous avec votre e-mail et votre mot de passe.";

describe("messages d'erreur de la connexion sociale", () => {
  it("même message pour un compte existant non relié, refusé ou impossible à relier", () => {
    for (const code of ["account_not_linked", "social_not_allowed", "unable_to_link_account"]) {
      expect(socialErrorMessage(code)).toBe(EXISTING);
    }
  });

  it("messages dédiés : annulation, e-mail absent, état expiré, session refusée", () => {
    expect(socialErrorMessage("access_denied")).toBe("Connexion annulée.");
    expect(socialErrorMessage("email_not_found")).toMatch(/adresse e-mail/);
    for (const code of ["state_mismatch", "state_not_found", "state_invalid", "please_restart_the_process"]) {
      expect(socialErrorMessage(code)).toBe("La connexion a expiré. Réessayez.");
    }
    expect(socialErrorMessage("unable_to_create_session")).toBe("Ce compte ne peut pas se connecter. Contactez la boutique.");
  });

  it("code inconnu ou hors liste : message générique, jamais le texte reçu", () => {
    expect(socialErrorMessage("invalid_code")).toBe(GENERIC);
    expect(socialErrorMessage("<script>x</script>")).toBe(GENERIC);
    expect(socialErrorMessage("toString")).toBe(GENERIC);
    expect(socialErrorMessage("__proto__")).toBe(GENERIC);
    expect(socialErrorMessage(["account_not_linked"])).toBe(GENERIC);
  });

  it("aucun message sans code", () => {
    expect(socialErrorMessage(undefined)).toBeUndefined();
    expect(socialErrorMessage("")).toBeUndefined();
  });
});
