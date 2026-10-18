/**
 * CSV au format tableur français : séparateur « ; », BOM UTF-8 (accents corrects dans Excel),
 * guillemets doublés. Lecture tolérante au séparateur « , » et aux fins de ligne CRLF.
 */
export const CSV_SEPARATOR = ";";
const BOM = "﻿";
/** Préfixes interprétés comme formules par les tableurs (injection CSV). */
const FORMULA_START = /^[=+\-@\t\r]/;

export type CsvCell = string | number | null | undefined;

function formatCell(value: CsvCell): string {
  if (value === null || value === undefined) return "";
  if (typeof value === "number") return String(value);
  const text = FORMULA_START.test(value) ? `'${value}` : value;
  return /[";\n\r,]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
}

export function toCsv(rows: readonly (readonly CsvCell[])[]): string {
  return BOM + rows.map((row) => row.map(formatCell).join(CSV_SEPARATOR)).join("\r\n") + "\r\n";
}

function detectSeparator(text: string): string {
  const firstLine = text.slice(0, text.search(/\r?\n|$/));
  return firstLine.includes(";") || !firstLine.includes(",") ? ";" : ",";
}

/** Lignes du fichier (cellules brutes, non retaillées). Erreur si un guillemet n'est pas refermé. */
export function parseCsv(input: string): string[][] {
  const text = input.startsWith(BOM) ? input.slice(1) : input;
  const separator = detectSeparator(text);
  const rows: string[][] = [];
  let row: string[] = [];
  let cell = "";
  let quoted = false;

  for (let i = 0; i < text.length; i += 1) {
    const char = text[i]!;
    if (quoted) {
      if (char === '"' && text[i + 1] === '"') {
        cell += '"';
        i += 1;
      } else if (char === '"') {
        quoted = false;
      } else {
        cell += char;
      }
    } else if (char === '"' && cell === "") {
      quoted = true;
    } else if (char === separator) {
      row.push(cell);
      cell = "";
    } else if (char === "\n" || char === "\r") {
      if (char === "\r" && text[i + 1] === "\n") i += 1;
      rows.push([...row, cell]);
      row = [];
      cell = "";
    } else {
      cell += char;
    }
  }
  if (quoted) throw new Error("Guillemet non refermé dans le fichier CSV.");
  if (cell !== "" || row.length > 0) rows.push([...row, cell]);
  return rows.filter((cells) => cells.some((value) => value.trim() !== ""));
}
