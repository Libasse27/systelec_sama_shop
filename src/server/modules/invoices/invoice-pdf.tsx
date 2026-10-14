import "server-only";
import { Document, Page, Text, View, renderToBuffer } from "@react-pdf/renderer";
import { formatDate } from "@/lib/dates";
import { PdfCompanyHeader, PdfFooter, PdfLine, pdfMoney, pdfStyles, pdfText } from "@/server/documents/pdf-kit";
import type { InvoiceData } from "./service";

function InvoiceDocument({ invoice }: { invoice: InvoiceData }) {
  const { company, customer } = invoice;
  const balance = invoice.total - invoice.amountPaid;
  return (
    <Document title={`Facture ${invoice.number}`} author={company.name} creator={company.name}>
      <Page size="A4" style={pdfStyles.page}>
        <PdfCompanyHeader company={company} />
        <Text style={pdfStyles.title}>Facture {invoice.number}</Text>
        <Text>
          {pdfText(`Émise le ${formatDate(invoice.issuedAt)} · Intervention ${invoice.interventionNumber}`)}
          {invoice.quoteNumber && pdfText(` · Devis ${invoice.quoteNumber}`)}
        </Text>
        <Text style={pdfStyles.muted}>
          {pdfText(`Client : ${customer.name} · ${customer.phone}${customer.email ? ` · ${customer.email}` : ""}`)}
        </Text>
        <Text style={pdfStyles.muted}>{pdfText(`Lieu d'intervention : ${customer.address}`)}</Text>

        <View style={pdfStyles.table}>
          {invoice.lines.map((line, index) => (
            <PdfLine
              key={`${index}-${line.label}`}
              label={`${line.label} — ${line.quantity} × ${pdfMoney(line.unitPrice)}`}
              value={pdfMoney(line.lineTotal)}
            />
          ))}
          <PdfLine label="Total TTC" value={pdfMoney(invoice.total)} strong />
          <PdfLine label="Réglé en espèces à ce jour" value={pdfMoney(invoice.amountPaid)} />
          <PdfLine label="Reste à payer" value={pdfMoney(balance)} strong />
        </View>

        <PdfFooter text={`Règlement en espèces uniquement. Prix TTC. Document commercial établi par ${company.name}.`} />
      </Page>
    </Document>
  );
}

export function renderInvoicePdf(invoice: InvoiceData): Promise<Buffer> {
  return renderToBuffer(<InvoiceDocument invoice={invoice} />);
}
