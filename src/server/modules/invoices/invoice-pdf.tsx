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
          {pdfText(`Émise le ${formatDate(invoice.issuedAt)} · ${invoice.document.label} ${invoice.document.number}`)}
          {invoice.quoteNumber && pdfText(` · Devis ${invoice.quoteNumber}`)}
        </Text>
        <Text style={pdfStyles.muted}>
          {pdfText(`Client : ${customer.name} · ${customer.phone}${customer.email ? ` · ${customer.email}` : ""}`)}
        </Text>
        {customer.address && (
          <Text style={pdfStyles.muted}>{pdfText(invoice.document.label === "Intervention" ? `Lieu d'intervention : ${customer.address}` : customer.address)}</Text>
        )}

        <View style={pdfStyles.table}>
          {invoice.lines.map((line, index) => (
            <PdfLine
              key={`${index}-${line.label}`}
              label={`${line.label} — ${line.quantity} × ${pdfMoney(line.unitPrice)}`}
              value={pdfMoney(line.lineTotal)}
            />
          ))}
          <PdfLine label="Total TTC" value={pdfMoney(invoice.total)} strong />
          {invoice.vat && <PdfLine label={`Dont TVA (${invoice.vat.rate} %)`} value={pdfMoney(invoice.vat.amount)} />}
          <PdfLine label="Réglé en espèces" value={pdfMoney(invoice.amountPaid)} />
          {invoice.refunded > 0 && <PdfLine label="Remboursé depuis (retour d'articles)" value={pdfMoney(invoice.refunded)} />}
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
