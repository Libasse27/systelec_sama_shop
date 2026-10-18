import { describe, expect, it } from "vitest";
import { signInSchema, signUpSchema } from "./schemas";

const valid = { name: "Awa Diop", email: "  Awa.Diop@Example.SN ", phone: "+221 77 000 00 00", password: "motdepasse-solide" };

describe("formulaires d'authentification", () => {
  it("normalise l'e-mail et accepte un téléphone vide", () => {
    const parsed = signUpSchema.parse({ ...valid, phone: "" });
    expect(parsed.email).toBe("awa.diop@example.sn");
    expect(parsed.phone).toBeUndefined();
  });

  it("exige un mot de passe d'au moins 10 caractères", () => {
    expect(signUpSchema.safeParse({ ...valid, password: "court" }).success).toBe(false);
  });

  it("ignore tout champ « kind » ou « isActive » fourni par le client", () => {
    const parsed = signUpSchema.parse({ ...valid, kind: "STAFF", isActive: false });
    expect(parsed).not.toHaveProperty("kind");
    expect(parsed).not.toHaveProperty("isActive");
  });

  it("refuse un e-mail invalide à la connexion", () => {
    expect(signInSchema.safeParse({ email: "pas-un-email", password: "x" }).success).toBe(false);
  });
});
