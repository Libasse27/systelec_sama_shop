import "server-only";
import { Document, Page, Text, View, renderToBuffer } from "@react-pdf/renderer";
import { formatDateTime } from "@/lib/dates";
import { PdfCompanyHeader, PdfFooter, PdfLine, pdfMoney, pdfStyles, pdfText } from "@/server/documents/pdf-kit";
import type { ReceiptData } from "./queries";

function ReceiptDocument({ receipt }: { receipt: ReceiptData }) {
  const { company } = receipt;
  return (
    <Document title={`Reçu ${receipt.receiptNumber}`} author={company.name} creator={company.name}>
      <Page size="A5" style={pdfStyles.page}>
        <PdfCompanyHeader company={company} />
        <Text style={pdfStyles.title}>
          {receipt.refund ? "Reçu de remboursement en espèces" : receipt.reversal ? "Reçu d'annulation d'encaissement" : "Reçu de paiement en espèces"}
        </Text>
        <Text>
          N° {receipt.receiptNumber} — {pdfText(formatDateTime(receipt.createdAt))}
        </Text>
        {receipt.voidedBy && <Text style={pdfStyles.alert}>Encaissement annulé par le reçu {receipt.voidedBy}.</Text>}

        <View style={pdfStyles.table}>
          <PdfLine label={receipt.document.label} value={receipt.document.number} />
          <PdfLine label="Client" value={`${receipt.customer.name} · ${receipt.customer.phone}`} />
          <PdfLine label="Montant total" value={pdfMoney(receipt.document.total)} />
          {receipt.refund ? (
            <>
              <PdfLine label="Retour" value={receipt.refund.returnNumber} />
              <PdfLine label="Montant remboursé en espèces" value={pdfMoney(-receipt.amount)} strong />
            </>
          ) : receipt.reversal ? (
            <>
              <PdfLine label="Reçu annulé" value={receipt.reversal.receiptNumber} />
              <PdfLine label="Motif" value={receipt.reversal.reason} />
              <PdfLine label="Montant annulé (espèces rendues)" value={pdfMoney(-receipt.amount)} strong />
            </>
          ) : (
            <PdfLine label="Montant reçu en espèces" value={pdfMoney(receipt.amount)} strong />
          )}
          {!receipt.refund && <PdfLine label="Reste à payer après ce reçu" value={pdfMoney(receipt.balanceAfter)} />}
          <PdfLine label="Enregistré par" value={receipt.recordedBy} />
        </View>

        <PdfFooter text={`Paiement en espèces uniquement. Document commercial établi par ${company.name}. Conservez ce reçu.`} />
      </Page>
    </Document>
  );
}

export function renderReceiptPdf(receipt: ReceiptData): Promise<Buffer> {
  return renderToBuffer(<ReceiptDocument receipt={receipt} />);
}
