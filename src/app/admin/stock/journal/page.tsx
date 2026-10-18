import type { Metadata } from "next";
import { PageHeader, pageParam, secondaryLinkClass } from "@/components/admin/admin-ui";
import { MovementsTable } from "@/components/admin/movements-table";
import Link from "next/link";
import { requirePermission } from "@/server/auth/session";
import { db } from "@/server/db/client";
import { listStockMovements, MOVEMENTS_PAGE_SIZE } from "@/server/modules/inventory/service";

export const metadata: Metadata = { title: "Journal du stock", robots: { index: false } };

type SearchParams = Promise<Record<string, string | string[] | undefined>>;

export default async function StockJournalPage({ searchParams }: { searchParams: SearchParams }) {
  const user = await requirePermission("inventory.read", "/admin/stock/journal");
  const page = pageParam((await searchParams).page);
  const movements = await listStockMovements(db, user, { page });

  return (
    <>
      <PageHeader title="Journal des mouvements de stock" />
      <div className="rounded-xl border border-line bg-surface">
        <MovementsTable movements={movements} showProduct />
      </div>
      <nav aria-label="Pagination" className="mt-4 flex justify-between">
        {page > 1 ? (
          <Link href={page === 2 ? "/admin/stock/journal" : `/admin/stock/journal?page=${page - 1}`} className={secondaryLinkClass}>
            Plus récents
          </Link>
        ) : (
          <span />
        )}
        {movements.length === MOVEMENTS_PAGE_SIZE && (
          <Link href={`/admin/stock/journal?page=${page + 1}`} className={secondaryLinkClass}>
            Plus anciens
          </Link>
        )}
      </nav>
    </>
  );
}
