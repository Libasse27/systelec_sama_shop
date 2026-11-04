import { randomUUID } from "node:crypto";
import { describe, expect, it } from "vitest";
import { refundReturnSchema } from "@/server/modules/returns/schemas";
import { recordPaymentSchema } from "./schemas";

const base = () => ({ idempotencyKey: randomUUID() });
const record = (input: Record<string, unknown>) => recordPaymentSchema.safeParse({ amount: 1000, ...base(), ...input });
const refund = (input: Record<string, unknown>) => refundReturnSchema.safeParse({ ...base(), ...input });
const referenceErrors = (result: { success: boolean; error?: { issues: { path: PropertyKey[]; message: string }[] } }) =>
  result.error?.issues.filter((issue) => issue.path[0] === "transactionReference").map((issue) => issue.message) ?? [];

describe.each([
  ["encaissement", record],
  ["remboursement", refund],
])("référence de transaction (%s)", (_label, parse) => {
  it("refuse un moyen mobile sans référence, sur le champ de la référence", () => {
    for (const input of [{ method: "WAVE" }, { method: "WAVE", transactionReference: "" }, { method: "WAVE", transactionReference: "   " }, { method: "WAVE", transactionReference: null }]) {
      expect(referenceErrors(parse(input))).toEqual(["Indiquez la référence de la transaction"]);
    }
  });

  it("refuse une référence avec des espèces, y compris par défaut, sans l'ignorer", () => {
    expect(referenceErrors(parse({ method: "CASH", transactionReference: "ABCD1234" }))).toEqual([
      "Une référence ne s'applique qu'à un paiement mobile : retirez-la pour des espèces.",
    ]);
    expect(parse({ transactionReference: "ABCD1234" }).success).toBe(false);
  });

  it("garde espèces par défaut, sans référence, et espèces avec champ vide", () => {
    expect(parse({})).toMatchObject({ success: true, data: { method: "CASH", transactionReference: null } });
    expect(parse({ method: "CASH", transactionReference: "  " })).toMatchObject({ success: true, data: { transactionReference: null } });
  });

  it("normalise : espaces retirés et majuscules", () => {
    expect(parse({ method: "WAVE", transactionReference: " ta 12.b_c-9 " })).toMatchObject({ success: true, data: { transactionReference: "TA12.B_C-9" } });
  });

  it("borne la longueur à 4..64 et les caractères à [A-Z0-9._-]", () => {
    expect(parse({ method: "WAVE", transactionReference: "ABC" }).success).toBe(false);
    expect(parse({ method: "WAVE", transactionReference: "----" }).success).toBe(false);
    expect(parse({ method: "WAVE", transactionReference: " . _ - _ " }).success).toBe(false);
    expect(parse({ method: "WAVE", transactionReference: "--A1--" }).success).toBe(true);
    expect(parse({ method: "WAVE", transactionReference: "ABCD" }).success).toBe(true);
    expect(parse({ method: "WAVE", transactionReference: "A".repeat(64) }).success).toBe(true);
    expect(parse({ method: "WAVE", transactionReference: "A".repeat(65) }).success).toBe(false);
    for (const bad of ["ABC#1234", "ABCD'; DROP", "ÉTÉ12345", "AB😀CD12", "ABCD/1234"]) {
      expect(referenceErrors(parse({ method: "WAVE", transactionReference: bad }))).toHaveLength(1);
    }
  });

  it("refuse un type invalide", () => {
    expect(parse({ method: "WAVE", transactionReference: 12345678 }).success).toBe(false);
  });
});
