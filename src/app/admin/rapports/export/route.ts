import type { NextRequest } from "next/server";
import { getCurrentUser } from "@/server/auth/session";
import { db } from "@/server/db/client";
import { AppError } from "@/server/errors";
import { exportFinancialReport, isExportFormat } from "@/server/modules/reports/exports";
import { parseReportPeriod } from "@/server/modules/reports/period";

export const dynamic = "force-dynamic";

const plain = (message: string, status: number) => new Response(message, { status, headers: { "Content-Type": "text/plain; charset=utf-8", "Cache-Control": "no-store" } });

/** Export du rapport financier : ?format=csv|xlsx|pdf&du=AAAA-MM-JJ&au=AAAA-MM-JJ (reports.export). */
export async function GET(request: NextRequest) {
  const user = await getCurrentUser();
  if (!user) return plain("Connexion requise", 401);
  const params = request.nextUrl.searchParams;
  const format = params.get("format");
  if (!isExportFormat(format)) return plain("Format inconnu : csv, xlsx ou pdf.", 400);
  const period = parseReportPeriod(params.get("du") ?? undefined, params.get("au") ?? undefined);
  if ("error" in period) return plain(period.error, 400);
  try {
    const file = await exportFinancialReport(db, user, period, format);
    return new Response(file.body, {
      headers: {
        "Content-Type": file.contentType,
        "Content-Disposition": `attachment; filename="${file.filename}"`,
        "Cache-Control": "private, no-store",
        "X-Content-Type-Options": "nosniff",
      },
    });
  } catch (error) {
    if (error instanceof AppError && error.code === "FORBIDDEN") return plain("Accès refusé", 403);
    throw error;
  }
}
