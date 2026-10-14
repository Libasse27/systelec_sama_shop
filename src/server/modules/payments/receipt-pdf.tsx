import "server-only";
import { Document, Page, StyleSheet, Text, View, renderToBuffer } from "@react-pdf/renderer";
import { formatDateTime } from "@/lib/dates";
import { formatFcfa } from "@/lib/money";
import type { ReceiptData } from "./queries";

/**
 * La police intégrée (Helvetica, encodage WinAnsi) n'a pas l'espace fine insécable
 * qu'Intl utilise comme séparateur de milliers en français : elle est remplacée.
 */
export const pdfText = (value: string): string => value.replace(/[  ]/g, " ");
const money = (amount: number) => pdfText(formatFcfa(amount));

const styles = StyleSheet.create({
  page: { padding: 36, fontSize: 10, fontFamily: "Helvetica", color: "#111827" },
  header: { flexDirection: "row", justifyContent: "space-between", marginBottom: 24 },
  company: { fontSize: 14, fontFamily: "Helvetica-Bold" },
  muted: { color: "#4b5563" },
  title: { fontSize: 16, fontFamily: "Helvetica-Bold", marginBottom: 4 },
  void: { marginTop: 8, padding: 6, borderWidth: 1, borderColor: "#b91c1c", color: "#b91c1c" },
  table: { marginTop: 16, borderTopWidth: 1, borderColor: "#d1d5db" },
  row: { flexDirection: "row", justifyContent: "space-between", paddingVertical: 6, borderBottomWidth: 1, borderColor: "#e5e7eb" },
  strong: { fontFamily: "Helvetica-Bold" },
  footer: { position: "absolute", bottom: 36, left: 36, right: 36, fontSize: 8, color: "#6b7280" },
});

function Line({ label, value, strong = false }: { label: string; value: string; strong?: boolean }) {
  return (
    <View style={styles.row}>
      <Text>{pdfText(label)}</Text>
      <Text style={strong ? styles.strong : undefined}>{pdfText(value)}</Text>
    </View>
  );
}

function ReceiptDocument({ receipt }: { receipt: ReceiptData }) {
  const { company } = receipt;
  const isReversal = receipt.reversal !== null;
  const legal = [company.ninea && `NINEA : ${company.ninea}`, company.rccm && `RCCM : ${company.rccm}`].filter(Boolean).join(" · ");
  const contact = [company.address, company.phone, company.email].filter(Boolean).join(" · ");
  return (
    <Document title={`Reçu ${receipt.receiptNumber}`} author={company.name} creator={company.name}>
      <Page size="A5" style={styles.page}>
        <View style={styles.header}>
          <View>
            <Text style={styles.company}>{pdfText(company.name)}</Text>
            {contact && <Text style={styles.muted}>{pdfText(contact)}</Text>}
            {legal && <Text style={styles.muted}>{pdfText(legal)}</Text>}
          </View>
        </View>

        <Text style={styles.title}>{isReversal ? "Reçu d'annulation d'encaissement" : "Reçu de paiement en espèces"}</Text>
        <Text>
          N° {receipt.receiptNumber} — {pdfText(formatDateTime(receipt.createdAt))}
        </Text>
        {receipt.voidedBy && <Text style={styles.void}>Encaissement annulé par le reçu {receipt.voidedBy}.</Text>}

        <View style={styles.table}>
          <Line label="Commande" value={receipt.orderNumber} />
          <Line label="Client" value={`${receipt.customer.name} · ${receipt.customer.phone}`} />
          <Line label="Total de la commande" value={money(receipt.orderTotal)} />
          {receipt.reversal ? (
            <>
              <Line label="Reçu annulé" value={receipt.reversal.receiptNumber} />
              <Line label="Motif" value={receipt.reversal.reason} />
              <Line label="Montant annulé (espèces rendues)" value={money(-receipt.amount)} strong />
            </>
          ) : (
            <Line label="Montant reçu en espèces" value={money(receipt.amount)} strong />
          )}
          <Line label="Reste à payer après ce reçu" value={money(receipt.balanceAfter)} />
          <Line label="Enregistré par" value={receipt.recordedBy} />
        </View>

        <Text style={styles.footer}>
          {pdfText(`Paiement en espèces uniquement. Document commercial établi par ${company.name}. Conservez ce reçu.`)}
        </Text>
      </Page>
    </Document>
  );
}

export function renderReceiptPdf(receipt: ReceiptData): Promise<Buffer> {
  return renderToBuffer(<ReceiptDocument receipt={receipt} />);
}
