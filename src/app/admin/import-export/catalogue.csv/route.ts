import { businessDateKey } from "@/lib/dates";
import { getCurrentUser } from "@/server/auth/session";
import { db } from "@/server/db/client";
import { AppError } from "@/server/errors";
import { exportCatalogCsv } from "@/server/modules/catalog/csv-transfer";

export const dynamic = "force-dynamic";

/** Téléchargement du catalogue (une ligne par version) au format CSV. */
export async function GET() {
  const user = await getCurrentUser();
  if (!user) return new Response("Connexion requise", { status: 401 });
  try {
    const csv = await exportCatalogCsv(db, user);
    return new Response(csv, {
      headers: {
        "Content-Type": "text/csv; charset=utf-8",
        "Content-Disposition": `attachment; filename="catalogue-${businessDateKey()}.csv"`,
        "Cache-Control": "no-store",
      },
    });
  } catch (error) {
    if (error instanceof AppError && error.code === "FORBIDDEN") return new Response("Accès refusé", { status: 403 });
    throw error;
  }
}
