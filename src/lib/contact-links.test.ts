import { describe, expect, it } from "vitest";
import { telHref, whatsappHref } from "./contact-links";

describe("liens de contact", () => {
  it("compose un numéro de téléphone sans espaces ni tirets, en gardant l'indicatif", () => {
    expect(telHref("+221 77-123 45 67")).toBe("tel:+221771234567");
  });

  it("construit un lien WhatsApp avec les chiffres seuls", () => {
    expect(whatsappHref("+221 77 123 45 67")).toBe("https://wa.me/221771234567");
  });

  it("refuse un numéro WhatsApp sans chiffre", () => {
    expect(whatsappHref("à venir")).toBeNull();
  });
});
