import { existsSync } from "node:fs";
import { PaymentMethod } from "@/generated/prisma/enums";
import { describe, expect, it } from "vitest";
import {
  ACCEPTED_PAYMENT_METHODS,
  isMobilePaymentMethod,
  normalizeTransactionReference,
  PAYMENT_METHOD_ICONS,
  PAYMENT_METHOD_LABELS,
  PAYMENT_METHOD_OPTIONS,
  PAYMENT_METHODS,
  paymentMethodPhrase,
  transactionReferenceKey,
} from "./payment-methods";

describe("moyens de paiement", () => {
  it("couvre exactement l'énumération Prisma PaymentMethod", () => {
    expect([...PAYMENT_METHODS].sort()).toEqual(Object.values(PaymentMethod).sort());
  });

  it("propose exactement espèces, Orange Money et Wave, espèces en premier", () => {
    expect(PAYMENT_METHODS).toEqual(["CASH", "ORANGE_MONEY", "WAVE"]);
    expect(PAYMENT_METHOD_OPTIONS).toEqual([
      { value: "CASH", label: "Espèces" },
      { value: "ORANGE_MONEY", label: "Orange Money" },
      { value: "WAVE", label: "Wave" },
    ]);
    expect(PAYMENT_METHOD_LABELS.WAVE).toBe("Wave");
  });

  it("forme la tournure de chaque moyen dans une phrase", () => {
    expect(paymentMethodPhrase("CASH")).toBe("en espèces");
    expect(paymentMethodPhrase("ORANGE_MONEY")).toBe("par Orange Money");
    expect(paymentMethodPhrase("WAVE")).toBe("par Wave");
  });

  it("traite un message mis en file avant cette évolution (sans moyen) comme des espèces", () => {
    expect(paymentMethodPhrase(undefined)).toBe("en espèces");
  });

  it("chaque moyen a son pictogramme publié", () => {
    for (const method of PAYMENT_METHODS) {
      expect(existsSync(`public/icones/${PAYMENT_METHOD_ICONS[method].name}.png`)).toBe(true);
    }
  });

  it("énonce les trois moyens acceptés", () => {
    expect(ACCEPTED_PAYMENT_METHODS).toBe("en espèces, par Orange Money ou par Wave");
  });

  it("les moyens mobiles sont tous ceux qui ne sont pas des espèces", () => {
    expect(PAYMENT_METHODS.filter(isMobilePaymentMethod)).toEqual(["ORANGE_MONEY", "WAVE"]);
    expect(isMobilePaymentMethod("CASH")).toBe(false);
  });

  it("normalise la référence : espaces retirés, majuscules, vide devient null", () => {
    expect(normalizeTransactionReference("  ab 12 cd-9  ")).toBe("AB12CD-9");
    expect(normalizeTransactionReference("t\t1\n2 3x")).toBe("T123X");
    expect(normalizeTransactionReference("   ")).toBeNull();
    expect(normalizeTransactionReference("")).toBeNull();
    expect(normalizeTransactionReference(undefined)).toBeNull();
    expect(normalizeTransactionReference(null)).toBeNull();
  });

  it("la clé canonique ignore point, tiret et tiret bas, et rien d'autre", () => {
    for (const form of ["TX-123", "tx.123", " T x_1 23 ", "TX123"]) expect(transactionReferenceKey(form)).toBe("TX123");
    expect(transactionReferenceKey("A1-B2")).not.toBe(transactionReferenceKey("A1B3"));
    expect(transactionReferenceKey("AB12")).toBe("AB12");
  });

  it("la clé d'une référence faite de séparateurs est vide", () => {
    expect(transactionReferenceKey("----")).toBe("");
    expect(transactionReferenceKey("._-_")).toBe("");
  });

  it("la clé d'une référence absente est vide", () => {
    expect(transactionReferenceKey(null)).toBe("");
    expect(transactionReferenceKey(undefined)).toBe("");
    expect(transactionReferenceKey("   ")).toBe("");
  });
});
