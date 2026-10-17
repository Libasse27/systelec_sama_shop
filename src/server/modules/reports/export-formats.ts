import "server-only";
import writeXlsxFile, { type Cell, type Row } from "write-excel-file/node";
import { toCsv, type CsvCell } from "@/lib/csv";
import { formatDate, formatDateTime } from "@/lib/dates";
import type { FinancialReport } from "./financial";

/** Feuille du classeur (surcharge « plusieurs feuilles » de la bibliothèque). */
type XlsxSheet = Parameters<typeof writeXlsxFile>[0][number];

/** Journal des écritures de la période (une ligne par reçu), pour un tableur ou un comptable. */
export function financialReportCsv(report: FinancialReport): string {
  const rows: CsvCell[][] = [
    ["Date", "Reçu", "Type", "Document", "Montant (FCFA)", "Agent", "Motif"],
    ...report.entries.map((entry) => [formatDateTime(entry.createdAt), entry.receiptNumber, entry.kind, entry.document, entry.amount, entry.recordedBy, entry.reason]),
    // Un journal tronqué ne doit jamais passer pour complet.
    ...(report.truncated ? [[`EXPORT TRONQUÉ : ${report.entries.length} écritures au plus ; réduisez la période pour obtenir le détail complet.`]] : []),
  ];
  return toCsv(rows);
}

const header = (labels: string[]): Row => labels.map((value) => ({ value, fontWeight: "bold" as const }));
/** Texte toujours écrit comme TEXTE (jamais comme formule, même s'il commence par « = »). */
const text = (value: string | null | undefined): Cell => ({ value: value ?? "", type: String });
const money = (value: number): Cell => ({ value, type: Number, format: "#,##0" });
const dateTime = (value: Date): Cell => ({ value, type: Date, format: "dd/mm/yyyy hh:mm" });

function summarySheet(report: FinancialReport): XlsxSheet {
  const { cash, sales, invoicedInterventions, byDocument } = report;
  const line = (label: string, value: number): Row => [text(label), money(value)];
  return {
    sheet: "Synthèse",
    columns: [{ width: 44 }, { width: 18 }],
    data: [
      [{ value: `Rapport financier du ${formatDate(report.period.from)} au ${formatDate(new Date(report.period.to.getTime() - 1))}`, fontWeight: "bold" }],
      [],
      header(["Caisse (espèces)", "FCFA"]),
      line("Encaissé", cash.received),
      line("Annulé (contre-écritures)", cash.voided),
      line("Remboursé (retours)", cash.refunded),
      line("Net en caisse", cash.net),
      line("Dont commandes", byDocument.orders),
      line("Dont interventions", byDocument.interventions),
      [],
      header(["Ventes remises au client", "Valeur"]),
      line("Commandes remises", sales.count),
      line("Articles vendus", sales.itemsSold),
      line("Montant TTC (FCFA)", sales.total),
      line("Dont frais de livraison (FCFA)", sales.deliveryFees),
      [],
      header(["Interventions facturées", "Valeur"]),
      line("Factures émises", invoicedInterventions.count),
      line("Montant TTC (FCFA)", invoicedInterventions.total),
      ...(report.truncated ? [[], [text(`Écritures détaillées limitées : les totaux couvrent toute la période.`)]] : []),
    ],
  };
}

const totalsHeader = ["Encaissé", "Annulé", "Remboursé", "Net"];

/** Classeur Excel : synthèse, par jour, par agent, écritures, remboursements, interventions facturées. */
export function financialReportXlsx(report: FinancialReport): Promise<Buffer> {
  const sheets: XlsxSheet[] = [
    summarySheet(report),
    {
      sheet: "Par jour",
      columns: [{ width: 14 }, { width: 14 }, { width: 14 }, { width: 14 }, { width: 14 }],
      data: [header(["Jour", ...totalsHeader]), ...report.byDay.map((row) => [text(row.day), money(row.received), money(row.voided), money(row.refunded), money(row.net)])],
    },
    {
      sheet: "Par agent",
      columns: [{ width: 30 }, { width: 14 }, { width: 14 }, { width: 14 }, { width: 14 }, { width: 12 }],
      data: [
        header(["Agent", ...totalsHeader, "Écritures"]),
        ...report.byCashier.map((row) => [text(row.name), money(row.received), money(row.voided), money(row.refunded), money(row.net), money(row.count)]),
      ],
    },
    {
      sheet: "Écritures",
      columns: [{ width: 18 }, { width: 18 }, { width: 16 }, { width: 28 }, { width: 14 }, { width: 24 }, { width: 40 }],
      data: [
        header(["Date", "Reçu", "Type", "Document", "Montant (FCFA)", "Agent", "Motif"]),
        ...report.entries.map((entry) => [dateTime(entry.createdAt), text(entry.receiptNumber), text(entry.kind), text(entry.document), money(entry.amount), text(entry.recordedBy), text(entry.reason)]),
      ],
    },
    {
      sheet: "Remboursements",
      columns: [{ width: 18 }, { width: 18 }, { width: 18 }, { width: 18 }, { width: 14 }, { width: 24 }],
      data: [
        header(["Date", "Reçu", "Retour", "Commande", "Montant (FCFA)", "Agent"]),
        ...report.refunds.map((row) => [dateTime(row.createdAt), text(row.receiptNumber), text(row.returnNumber), text(row.orderNumber), money(row.amount), text(row.recordedBy)]),
      ],
    },
    {
      sheet: "Interventions facturées",
      columns: [{ width: 18 }, { width: 18 }, { width: 18 }, { width: 30 }, { width: 14 }],
      data: [
        header(["Date", "Facture", "Intervention", "Client", "Montant (FCFA)"]),
        ...report.invoicedInterventions.rows.map((row) => [dateTime(row.issuedAt), text(row.invoiceNumber), text(row.interventionNumber), text(row.customerName), money(row.total)]),
      ],
    },
  ];
  return writeXlsxFile(sheets).toBuffer();
}
