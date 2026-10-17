import "server-only";
import { recordAudit } from "@/server/audit/audit";
import { assertPermission, type Actor } from "@/server/authz/service";
import type { Db } from "@/server/db/client";
import { companyHeader } from "@/server/modules/payments/queries";
import { financialReportCsv, financialReportXlsx } from "./export-formats";
import { assertFinancialAccess, getFinancialReport } from "./financial";
import type { ReportPeriod } from "./period";
import { renderFinancialReportPdf } from "./report-pdf";

export const EXPORT_FORMATS = {
  csv: { contentType: "text/csv; charset=utf-8", extension: "csv" },
  xlsx: { contentType: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet", extension: "xlsx" },
  pdf: { contentType: "application/pdf", extension: "pdf" },
} as const;

export type ExportFormat = keyof typeof EXPORT_FORMATS;

export const isExportFormat = (value: unknown): value is ExportFormat => typeof value === "string" && Object.hasOwn(EXPORT_FORMATS, value);

export interface ExportedFile {
  body: Uint8Array<ArrayBuffer> | string;
  contentType: string;
  filename: string;
}

/**
 * Export du rapport financier (reports.export, en plus des droits de lecture du rapport), au
 * format CSV (journal des écritures), Excel (classeur complet) ou PDF (synthèse). Chaque export
 * est audité : il fait sortir des données financières de l'application.
 */
export async function exportFinancialReport(client: Db, actor: Actor, period: ReportPeriod, format: ExportFormat): Promise<ExportedFile> {
  await assertPermission(client, actor, "reports.export");
  await assertFinancialAccess(client, actor);
  const report = await getFinancialReport(client, actor, period);
  const body =
    format === "csv"
      ? financialReportCsv(report)
      : format === "xlsx"
        ? new Uint8Array(await financialReportXlsx(report))
        : new Uint8Array(await renderFinancialReportPdf(report, await companyHeader(client)));
  await recordAudit(client, {
    actorId: actor.id,
    action: "report.export",
    entityType: "FinancialReport",
    entityId: `${period.fromKey}_${period.toKey}`,
    after: { format, entries: report.entries.length, truncated: report.truncated },
  });
  const { contentType, extension } = EXPORT_FORMATS[format];
  return { body, contentType, filename: `rapport-financier-${period.fromKey}-${period.toKey}.${extension}` };
}
