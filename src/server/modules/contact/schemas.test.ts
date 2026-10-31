import { randomUUID } from "node:crypto";
import { describe, expect, it } from "vitest";
import { contactMessageSchema, contactStatusSchema } from "./schemas";

const valid = (overrides: Record<string, unknown> = {}) => ({
  idempotencyKey: randomUUID(),
  name: "Awa Diop",
  email: "Awa@Example.sn",
  phone: "",
  subject: "GENERAL",
  reference: "",
  message: "Bonjour, avez-vous ce produit en stock ?",
  website: "",
  ...overrides,
});

describe("message de contact (validation)", () => {
  it("accepte un message complet et normalise les champs facultatifs", () => {
    const parsed = contactMessageSchema.parse(valid());
    expect(parsed).toMatchObject({ email: "awa@example.sn", phone: null, reference: null, subject: "GENERAL" });
  });

  it("accepte un téléphone seul, sans e-mail", () => {
    expect(contactMessageSchema.parse(valid({ email: "", phone: "+221 77 000  00 00" }))).toMatchObject({ email: null, phone: "+221 77 000 00 00" });
  });

  it("exige au moins un moyen de répondre", () => {
    const result = contactMessageSchema.safeParse(valid({ email: "", phone: "" }));
    expect(result.success).toBe(false);
    expect(result.error?.issues[0]?.path).toEqual(["email"]);
  });

  it("refuse un message trop court, un sujet inconnu ou un téléphone invalide", () => {
    expect(contactMessageSchema.safeParse(valid({ message: "court" })).success).toBe(false);
    expect(contactMessageSchema.safeParse(valid({ subject: "SPAM" })).success).toBe(false);
    expect(contactMessageSchema.safeParse(valid({ phone: "abc" })).success).toBe(false);
  });

  it("refuse un nom sur plusieurs lignes ou contenant un lien (recopié dans l'accusé de réception)", () => {
    expect(contactMessageSchema.safeParse(valid({ name: "Awa\n\nVotre compte est suspendu" })).success).toBe(false);
    expect(contactMessageSchema.safeParse(valid({ name: "Awa https://faux-site.example" })).success).toBe(false);
    expect(contactMessageSchema.safeParse(valid({ name: "Awa\u200eDiop" })).success).toBe(false);
    expect(contactMessageSchema.parse(valid({ name: "Mame Diarra Bousso-N'Diaye" })).name).toBe("Mame Diarra Bousso-N'Diaye");
  });

  it("refuse le message si le champ piège est rempli", () => {
    expect(contactMessageSchema.safeParse(valid({ website: "http://spam.example" })).success).toBe(false);
  });

  it("n'autorise que la prise en charge et la clôture comme statuts cibles", () => {
    expect(contactStatusSchema.safeParse({ status: "NEW" }).success).toBe(false);
    expect(contactStatusSchema.safeParse({ status: "CLOSED" }).success).toBe(true);
  });
});
