import { z } from "zod";
import { describe, expect, it } from "vitest";
import { signInSchema, signUpFormSchema, signUpSchema } from "./schemas";

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

  describe("formulaire d'inscription (confirmation du mot de passe)", () => {
    const MISMATCH = "Les mots de passe ne correspondent pas";
    const withConfirmation = { ...valid, passwordConfirmation: valid.password };
    const confirmationErrors = (input: unknown) => {
      const result = signUpFormSchema.safeParse(input);
      if (result.success) return undefined;
      return z.flattenError(result.error).fieldErrors.passwordConfirmation;
    };

    it("accepte deux mots de passe identiques", () => {
      const parsed = signUpFormSchema.parse(withConfirmation);
      expect(parsed.password).toBe(valid.password);
      expect(parsed.email).toBe("awa.diop@example.sn");
    });

    it("signale la différence sur le champ de confirmation", () => {
      expect(confirmationErrors({ ...withConfirmation, passwordConfirmation: "autre-mot-de-passe" })).toEqual([
        "Les mots de passe ne correspondent pas",
      ]);
    });

    it("compare les chaînes brutes, sans retirer les espaces", () => {
      expect(confirmationErrors({ ...withConfirmation, passwordConfirmation: `${valid.password} ` })).toEqual([
        "Les mots de passe ne correspondent pas",
      ]);
    });

    it("refuse une confirmation absente", () => {
      expect(signUpFormSchema.safeParse(valid).success).toBe(false);
    });

    it("refuse une confirmation vide", () => {
      expect(confirmationErrors({ ...withConfirmation, passwordConfirmation: "" })).toEqual([MISMATCH]);
    });

    it("refuse des fichiers comme mot de passe ou confirmation, sans lever d'exception", () => {
      const file = new File(["x"], "mot-de-passe.txt");
      expect(() => signUpFormSchema.safeParse({ ...withConfirmation, passwordConfirmation: file })).not.toThrow();
      expect(signUpFormSchema.safeParse({ ...withConfirmation, passwordConfirmation: file }).success).toBe(false);
      expect(() => signUpFormSchema.safeParse({ ...withConfirmation, password: file })).not.toThrow();
      expect(signUpFormSchema.safeParse({ ...withConfirmation, password: file }).success).toBe(false);
    });

    it("signale la différence même si un autre champ est invalide", () => {
      expect(confirmationErrors({ ...withConfirmation, name: "A", passwordConfirmation: "autre" })).toEqual([
        "Les mots de passe ne correspondent pas",
      ]);
    });

    it("laisse signUpSchema accepter une entrée sans confirmation", () => {
      expect(signUpSchema.safeParse(valid).success).toBe(true);
    });
  });
});
