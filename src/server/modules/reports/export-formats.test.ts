import { describe, expect, it } from "vitest";
import { financialReportCsv } from "./export-formats";
import type { FinancialReport } from "./financial";

const report = (truncated: boolean): FinancialReport => ({
  period: { from: new Date("2026-10-01T00:00:00Z"), to: new Date("2026-10-02T00:00:00Z"), fromKey: "2026-10-01", toKey: "2026-10-01" },
  cash: { received: 1000, voided: 0, refunded: 0, net: 1000, count: 1 },
  byMethod: [],
  byCashier: [],
  byDay: [],
  byDocument: { orders: 1000, interventions: 0 },
  sales: { count: 0, total: 0, deliveryFees: 0, itemsSold: 0 },
  refunds: [],
  invoicedInterventions: { count: 0, total: 0, rows: [] },
  entries: [{ createdAt: new Date("2026-10-01T10:00:00Z"), receiptNumber: "REC-2026-000001", kind: "Encaissement", document: "Commande CMD-2026-000001", amount: 1000, recordedBy: "@agent", reason: null }],
  truncated,
});

describe("export CSV du rapport financier", () => {
  it("neutralise une cellule commençant par un caractère de formule", () => {
    expect(financialReportCsv(report(false))).toContain(";'@agent;");
  });

  it("signale un journal tronqué au lieu de le faire passer pour complet", () => {
    expect(financialReportCsv(report(false))).not.toContain("TRONQUÉ");
    expect(financialReportCsv(report(true))).toContain("EXPORT TRONQUÉ");
  });
});
