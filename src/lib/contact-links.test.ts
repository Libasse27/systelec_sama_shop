import { describe, expect, it } from "vitest";
import { mailtoHref, telHref, whatsappHref } from "./contact-links";

describe("telHref", () => {
  it("compose un numéro sans espaces ni tirets, en gardant l'indicatif", () => {
    expect(telHref("+221 77-123 45 67")).toBe("tel:+221771234567");
  });

  it("accepte points et parenthèses de présentation", () => {
    expect(telHref("+221 (33) 821.00.00")).toBe("tel:+221338210000");
  });

  it("accepte un numéro national sans indicatif", () => {
    expect(telHref("77 123 45 67")).toBe("tel:771234567");
  });

  it.each(["", "   ", "à venir", "77 123 45", "+", "77abc12345", "77 123 45 67;ext=1", "tel:77 123 45 67", "77 123 45 67\n+221", "+221 77 +123 45 67", "7712345678901234567"])(
    "refuse la valeur inutilisable %j",
    (value) => {
      expect(telHref(value)).toBeNull();
    },
  );
});

describe("whatsappHref", () => {
  it("construit un lien WhatsApp avec les chiffres seuls", () => {
    expect(whatsappHref("+221 77 123 45 67")).toBe("https://wa.me/221771234567");
  });

  it("remplace le préfixe international 00 par l'indicatif seul", () => {
    expect(whatsappHref("00221 77 123 45 67")).toBe("https://wa.me/221771234567");
  });

  it.each(["77 123 45 67", "771234567", "221771234567"])("refuse le numéro sans « + » ni « 00 » %j : wa.me le lirait comme un autre indicatif", (value) => {
    expect(whatsappHref(value)).toBeNull();
  });

  it.each(["", "à venir", "12345", "+221 77 1", "77 123 45 67?text=bonjour", "https://wa.me/221771234567", "221771234567/../x", "+221 77 123 45 67\r\nX: y", "2217712345678901234"])(
    "refuse la valeur inutilisable %j",
    (value) => {
      expect(whatsappHref(value)).toBeNull();
    },
  );
});

describe("mailtoHref", () => {
  it("construit un lien mailto pour une adresse valide", () => {
    expect(mailtoHref("contact@exemple.test")).toBe("mailto:contact@exemple.test");
    expect(mailtoHref("  prenom.nom+boutique@sous.exemple.test  ")).toBe("mailto:prenom.nom+boutique@sous.exemple.test");
    expect(mailtoHref("o'brien@exemple.test")).toBe("mailto:o'brien@exemple.test");
  });

  it.each([
    "",
    "   ",
    "pas-une-adresse",
    "a@b",
    "@exemple.test",
    "contact@exemple.test?subject=x",
    "contact@exemple.test?bcc=pirate@exemple.test",
    "contact@exemple.test&cc=pirate@exemple.test",
    "contact@exemple.test\nbcc: pirate@exemple.test",
    "contact@exemple.test\r\nCc: x@y.test",
    "a@exemple.test,b@exemple.test",
    "a@exemple.test;b@exemple.test",
    "contact@exemple.test#fragment",
    "contact@exemple.test%0Abcc=x",
    "co ntact@exemple.test",
    "<contact@exemple.test>",
    "javascript:alert(1)@exemple.test",
  ])("refuse la valeur %j (injection ou format)", (value) => {
    expect(mailtoHref(value)).toBeNull();
  });
});
