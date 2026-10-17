import { randomUUID } from "node:crypto";
import { strFromU8, unzipSync } from "fflate";
import { beforeEach, describe, expect, it } from "vitest";
import { businessDateKey } from "@/lib/dates";
import type { Actor } from "@/server/authz/service";
import { syncRolesAndPermissions } from "@/server/authz/sync";
import { db } from "@/server/db/client";
import { recordOrderPayment, voidPayment } from "@/server/modules/payments/service";
import { createReturn, decideReturn, refundReturn } from "@/server/modules/returns/service";
import { updateSetting } from "@/server/modules/settings/service";
import { settingsDefaults } from "@/server/modules/settings/schemas";
import { resetDatabase } from "../../../../tests/setup/db";
import { actorWith } from "../../../../tests/support/actors";
import { closedPickupOrder, confirmedOrder, seedOrderCatalog, type OrderFixtures } from "../../../../tests/support/orders";
import { getDashboard } from "./dashboard";
import { exportFinancialReport } from "./exports";
import { getFinancialReport } from "./financial";
import { parseReportPeriod, type ReportPeriod } from "./period";

let fixtures: OrderFixtures;
let manager: Actor;
let cashier: Actor;
let today: ReportPeriod;

/** Activité du jour : vente remise (50 000), encaissement annulé (20 000), remboursement (25 000). */
async function activity(): Promise<void> {
  const order = await closedPickupOrder(fixtures, manager, cashier);
  await updateSetting("commerce", { ...settingsDefaults.commerce, partialPaymentEnabled: true }, null);
  const other = await confirmedOrder(fixtures, manager, { lines: { "SW-02": 1 } });
  const { id } = await recordOrderPayment(db, cashier, other.id, { amount: 20_000, idempotencyKey: randomUUID(), note: "=HYPERLINK(\"http://x\")" });
  await voidPayment(db, cashier, id, { reason: "=1+1 erreur de saisie" });
  const item = await db.orderItem.findFirstOrThrow({ where: { orderId: order.id } });
  const created = await createReturn(db, manager, order.id, { idempotencyKey: randomUUID(), reason: "Défaut", items: [{ orderItemId: item.id, quantity: 1 }] });
  await decideReturn(db, manager, created.id, { decision: "ACCEPT", restock: true, refundAmount: 25_000, note: "Intact" });
  await refundReturn(db, cashier, created.id, { idempotencyKey: randomUUID() });
}

describe("rapports financiers et tableau de bord (PostgreSQL)", () => {
  beforeEach(async () => {
    await resetDatabase();
    await syncRolesAndPermissions(db);
    fixtures = await seedOrderCatalog();
    manager = await actorWith("ORDER_MANAGER");
    cashier = await actorWith("FINANCE_MANAGER");
    const key = businessDateKey();
    today = parseReportPeriod(key, key) as ReportPeriod;
  });

  it("totaux par moyen, agent, jour et document ; ventes ; remboursements ; interventions facturées", async () => {
    await activity();
    const report = await getFinancialReport(db, cashier, today);
    expect(report.cash).toEqual({ received: 70_000, voided: 20_000, refunded: 25_000, net: 25_000, count: 4 });
    expect(report.byMethod).toEqual([{ method: "CASH", label: "Espèces", net: 25_000 }]);
    expect(report.byCashier).toEqual([{ name: "FINANCE_MANAGER", received: 70_000, voided: 20_000, refunded: 25_000, net: 25_000, count: 4 }]);
    expect(report.byDay).toEqual([{ day: today.fromKey, received: 70_000, voided: 20_000, refunded: 25_000, net: 25_000 }]);
    expect(report.byDocument).toEqual({ orders: 25_000, interventions: 0 });
    expect(report.sales).toEqual({ count: 1, total: 50_000, deliveryFees: 0, itemsSold: 2 });
    expect(report.refunds).toHaveLength(1);
    expect(report.refunds[0]).toMatchObject({ amount: 25_000, returnNumber: expect.stringMatching(/^RET-/) });
    expect(report.entries.map((entry) => entry.kind)).toEqual(["Encaissement", "Encaissement", "Annulation", "Remboursement"]);
    expect(report.invoicedInterventions).toEqual({ count: 0, total: 0, rows: [] });

    // Une autre période : rien.
    const empty = await getFinancialReport(db, cashier, parseReportPeriod("2020-01-01", "2020-01-31") as ReportPeriod);
    expect(empty.cash).toEqual({ received: 0, voided: 0, refunded: 0, net: 0, count: 0 });
    expect(empty.byDay).toEqual([]);
  });

  it("droits : rapport avec reports.read ET payments.read ; export avec reports.export ; refus journalisés", async () => {
    const stock = await actorWith("STOCK_MANAGER"); // reports.read sans payments.read
    await expect(getFinancialReport(db, stock, today)).rejects.toMatchObject({ code: "FORBIDDEN" });
    await expect(getFinancialReport(db, manager, today)).rejects.toMatchObject({ code: "FORBIDDEN" });
    await expect(exportFinancialReport(db, manager, today, "csv")).rejects.toMatchObject({ code: "FORBIDDEN" });
    expect(await db.auditLog.count({ where: { action: "authz.denied" } })).toBe(3);
  });

  it("CSV : journal des écritures, formules neutralisées, export audité", async () => {
    await activity();
    const file = await exportFinancialReport(db, cashier, today, "csv");
    expect(file.contentType).toBe("text/csv; charset=utf-8");
    expect(file.filename).toBe(`rapport-financier-${today.fromKey}-${today.toKey}.csv`);
    const csv = file.body as string;
    expect(csv.split("\r\n")[0]).toBe("﻿Date;Reçu;Type;Document;Montant (FCFA);Agent;Motif");
    expect(csv).toContain(";'=1+1 erreur de saisie");
    expect(csv).not.toMatch(/;=1\+1/);
    expect(csv).not.toContain("HYPERLINK"); // la note interne n'est pas exportée
    expect(await db.auditLog.findFirst({ where: { action: "report.export" } })).toMatchObject({ actorId: cashier.id, after: { format: "csv", entries: 4 } });
  });

  it("Excel : classeur multi-feuilles, texte jamais écrit comme formule", async () => {
    await activity();
    const file = await exportFinancialReport(db, cashier, today, "xlsx");
    const entries = unzipSync(file.body as Uint8Array);
    const workbook = strFromU8(entries["xl/workbook.xml"]!);
    for (const name of ["Synthèse", "Par jour", "Par agent", "Écritures", "Remboursements", "Interventions facturées"]) expect(workbook).toContain(name);
    const sheets = Object.keys(entries).filter((path) => path.startsWith("xl/worksheets/sheet"));
    expect(sheets).toHaveLength(6);
    const allXml = Object.values(entries).map((bytes) => strFromU8(bytes)).join("");
    expect(allXml).not.toMatch(/<f>|<f /); // aucune formule
    expect(allXml).toContain("=1+1 erreur de saisie"); // présent, mais comme texte
  });

  it("PDF : synthèse imprimable", async () => {
    await activity();
    const file = await exportFinancialReport(db, cashier, today, "pdf");
    expect(file.contentType).toBe("application/pdf");
    expect(Buffer.from(file.body as Uint8Array).subarray(0, 5).toString()).toBe("%PDF-");
  });

  it("tableau de bord : chaque indicateur n'est calculé que si le rôle y a droit", async () => {
    await activity();
    const admin = await getDashboard(db, await actorWith("ADMIN"));
    expect(admin.orders).toEqual({ byStatus: { CONFIRMED: 1 }, returnsToProcess: 0 });
    expect(admin.sales?.today).toEqual({ count: 1, total: 50_000 });
    expect(admin.cashToday).toEqual({ received: 70_000, voided: 20_000, refunded: 25_000, net: 25_000 });
    expect(admin.lowStock).not.toBeNull();
    expect(admin.catalog).toEqual({ PUBLISHED: 2 });

    const technician = await getDashboard(db, await actorWith("TECHNICIAN"));
    expect(technician).toEqual({ orders: null, sales: null, cashToday: null, lowStock: null, quoteRequests: null, interventions: null, deliveries: null, catalog: null });

    const orders = await getDashboard(db, manager);
    expect(orders.sales).toBeNull(); // pas de reports.read
    expect(orders.cashToday).not.toBeNull(); // payments.read
    expect(orders.deliveries).toEqual({}); // deliveries.manage, aucune livraison
    expect(orders.quoteRequests).toBeNull();
  });
});
