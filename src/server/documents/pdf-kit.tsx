import "server-only";
import { StyleSheet, Text, View } from "@react-pdf/renderer";
import { formatFcfa } from "@/lib/money";
import type { CompanyHeader } from "@/server/modules/payments/queries";

/** Caractères hors Latin-1 que l'encodage WinAnsi de la police intégrée sait afficher. */
const WINANSI_EXTRAS = "€‚ƒ„…†‡ˆ‰Š‹ŒŽ‘’“”•–—˜™š›œžŸ";
/** Longueur maximale d'un texte saisi par un tiers dans un document imprimé. */
const MAX_PDF_TEXT = 500;
const NARROW_NO_BREAK_SPACE = 0x202f;
const NO_BREAK_SPACE = 0xa0;

const printable = (char: string): string => {
  const code = char.codePointAt(0)!;
  if (code === NARROW_NO_BREAK_SPACE || code === NO_BREAK_SPACE || char === "\n") return " ";
  return (code >= 0x20 && code <= 0x7e) || (code >= 0xa1 && code <= 0xff) || WINANSI_EXTRAS.includes(char) ? char : "?";
};

/**
 * Texte imprimable par la police intégrée (Helvetica, WinAnsi) : les espaces insécables
 * qu'Intl utilise comme séparateur de milliers deviennent des espaces, et tout caractère
 * non affichable (émoji, autre alphabet) est remplacé par « ? » au lieu de casser le rendu.
 */
export function pdfText(value: string): string {
  const text = Array.from(value.normalize("NFC"), printable).join("");
  return text.length > MAX_PDF_TEXT ? `${text.slice(0, MAX_PDF_TEXT - 1)}…` : text;
}
export const pdfMoney = (amount: number): string => pdfText(formatFcfa(amount));

/** Styles communs des documents imprimés (reçus, factures). */
export const pdfStyles = StyleSheet.create({
  page: { padding: 36, fontSize: 10, fontFamily: "Helvetica", color: "#111827" },
  header: { marginBottom: 24 },
  company: { fontSize: 14, fontFamily: "Helvetica-Bold" },
  muted: { color: "#4b5563" },
  title: { fontSize: 16, fontFamily: "Helvetica-Bold", marginBottom: 4 },
  alert: { marginTop: 8, padding: 6, borderWidth: 1, borderColor: "#b91c1c", color: "#b91c1c" },
  table: { marginTop: 16, borderTopWidth: 1, borderColor: "#d1d5db" },
  row: { flexDirection: "row", justifyContent: "space-between", paddingVertical: 6, borderBottomWidth: 1, borderColor: "#e5e7eb" },
  strong: { fontFamily: "Helvetica-Bold" },
  footer: { position: "absolute", bottom: 36, left: 36, right: 36, fontSize: 8, color: "#6b7280" },
});

/** Ligne libellé / valeur. */
export function PdfLine({ label, value, strong = false }: { label: string; value: string; strong?: boolean }) {
  return (
    <View style={pdfStyles.row}>
      <Text style={{ maxWidth: "65%" }}>{pdfText(label)}</Text>
      <Text style={strong ? pdfStyles.strong : undefined}>{pdfText(value)}</Text>
    </View>
  );
}

/** En-tête société : nom, coordonnées et mentions légales (D7) si elles sont renseignées. */
export function PdfCompanyHeader({ company }: { company: CompanyHeader }) {
  const legal = [company.ninea && `NINEA : ${company.ninea}`, company.rccm && `RCCM : ${company.rccm}`].filter(Boolean).join(" · ");
  const contact = [company.address, company.phone, company.email].filter(Boolean).join(" · ");
  return (
    <View style={pdfStyles.header}>
      <Text style={pdfStyles.company}>{pdfText(company.name)}</Text>
      {contact && <Text style={pdfStyles.muted}>{pdfText(contact)}</Text>}
      {legal && <Text style={pdfStyles.muted}>{pdfText(legal)}</Text>}
    </View>
  );
}

export function PdfFooter({ text }: { text: string }) {
  return <Text style={pdfStyles.footer}>{pdfText(text)}</Text>;
}
