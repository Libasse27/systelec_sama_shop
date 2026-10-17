import "server-only";
import { Document, Page, Text, View, renderToBuffer } from "@react-pdf/renderer";
import { formatDate, formatDateTime } from "@/lib/dates";
import { PdfCompanyHeader, PdfFooter, PdfLine, pdfMoney, pdfStyles, pdfText } from "@/server/documents/pdf-kit";
import type { CompanyHeader } from "@/server/modules/payments/queries";
import type { FinancialReport } from "./financial";

/** Lignes détaillées au plus par tableau du PDF (le détail complet est dans l'export Excel). */
export const PDF_TABLE_LIMIT = 200;

const sectionTitle = { fontSize: 12, fontFamily: "Helvetica-Bold", marginTop: 16 } as const;

function Limited<T>({ rows, render }: { rows: readonly T[]; render: (row: T, index: number) => React.ReactNode }) {
  return (
    <>
      {rows.slice(0, PDF_TABLE_LIMIT).map(render)}
      {rows.length > PDF_TABLE_LIMIT && <Text style={pdfStyles.muted}>{`… ${rows.length - PDF_TABLE_LIMIT} ligne(s) de plus : voir l'export Excel.`}</Text>}
    </>
  );
}

function ReportDocument({ report, company }: { report: FinancialReport; company: CompanyHeader }) {
  const { cash, sales, invoicedInterventions } = report;
  const lastDay = new Date(report.period.to.getTime() - 1);
  return (
    <Document title={`Rapport financier ${report.period.fromKey} ${report.period.toKey}`} author={company.name} creator={company.name}>
      <Page size="A4" style={pdfStyles.page}>
        <PdfCompanyHeader company={company} />
        <Text style={pdfStyles.title}>{pdfText(`Rapport financier du ${formatDate(report.period.from)} au ${formatDate(lastDay)}`)}</Text>
        <Text style={pdfStyles.muted}>{pdfText(`Édité le ${formatDateTime(new Date())}. Espèces uniquement.`)}</Text>

        <Text style={sectionTitle}>Caisse</Text>
        <View style={pdfStyles.table}>
          <PdfLine label="Encaissé" value={pdfMoney(cash.received)} />
          <PdfLine label="Annulé (contre-écritures)" value={pdfMoney(cash.voided)} />
          <PdfLine label="Remboursé (retours)" value={pdfMoney(cash.refunded)} />
          <PdfLine label="Net en caisse" value={pdfMoney(cash.net)} strong />
          <PdfLine label="Dont commandes" value={pdfMoney(report.byDocument.orders)} />
          <PdfLine label="Dont interventions" value={pdfMoney(report.byDocument.interventions)} />
        </View>

        <Text style={sectionTitle}>Ventes et prestations</Text>
        <View style={pdfStyles.table}>
          <PdfLine label={`Commandes remises au client (${sales.count}, ${sales.itemsSold} article(s))`} value={pdfMoney(sales.total)} />
          <PdfLine label="Dont frais de livraison" value={pdfMoney(sales.deliveryFees)} />
          <PdfLine label={`Interventions facturées (${invoicedInterventions.count})`} value={pdfMoney(invoicedInterventions.total)} />
        </View>

        <Text style={sectionTitle}>Net par agent</Text>
        <View style={pdfStyles.table}>
          {report.byCashier.length === 0 && <Text style={pdfStyles.muted}>Aucune écriture.</Text>}
          <Limited rows={report.byCashier} render={(row) => <PdfLine key={row.name} label={`${row.name} (${row.count} écriture(s))`} value={pdfMoney(row.net)} />} />
        </View>

        <Text style={sectionTitle}>Net par jour</Text>
        <View style={pdfStyles.table}>
          <Limited rows={report.byDay} render={(row) => <PdfLine key={row.day} label={row.day} value={pdfMoney(row.net)} />} />
        </View>

        {report.refunds.length > 0 && (
          <>
            <Text style={sectionTitle}>Remboursements</Text>
            <View style={pdfStyles.table}>
              <Limited
                rows={report.refunds}
                render={(row) => <PdfLine key={row.receiptNumber} label={`${row.receiptNumber} · retour ${row.returnNumber} · ${row.orderNumber}`} value={pdfMoney(row.amount)} />}
              />
            </View>
          </>
        )}
        {report.truncated && <Text style={pdfStyles.alert}>Écritures détaillées limitées : les totaux couvrent toute la période.</Text>}

        <PdfFooter text={`Document interne établi par ${company.name}. Montants TTC en francs CFA.`} />
      </Page>
    </Document>
  );
}

export function renderFinancialReportPdf(report: FinancialReport, company: CompanyHeader): Promise<Buffer> {
  return renderToBuffer(<ReportDocument report={report} company={company} />);
}
