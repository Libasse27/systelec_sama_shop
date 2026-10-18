import { formatDateTime } from "@/lib/dates";
import { MOVEMENT_TYPE_LABELS } from "@/lib/labels";
import type { StockMovementView } from "@/server/modules/inventory/service";

/** Journal des mouvements de stock (lecture seule : le journal est immuable). */
export function MovementsTable({ movements, showProduct = false }: { movements: readonly StockMovementView[]; showProduct?: boolean }) {
  if (movements.length === 0) return <p className="text-ink-muted">Aucun mouvement.</p>;
  return (
    <div className="overflow-x-auto">
      <table className="w-full text-left text-sm">
        <thead className="bg-surface-muted text-xs uppercase text-ink-muted">
          <tr>
            <th scope="col" className="px-3 py-2">Date</th>
            {showProduct && <th scope="col" className="px-3 py-2">Produit</th>}
            <th scope="col" className="px-3 py-2">Type</th>
            <th scope="col" className="px-3 py-2 text-right">Quantité</th>
            <th scope="col" className="px-3 py-2 text-right">Stock après</th>
            <th scope="col" className="px-3 py-2">Motif</th>
            <th scope="col" className="px-3 py-2">Par</th>
          </tr>
        </thead>
        <tbody>
          {movements.map((movement) => (
            <tr key={movement.id} className="border-t border-line">
              <td className="whitespace-nowrap px-3 py-2">{formatDateTime(movement.createdAt)}</td>
              {showProduct && (
                <td className="px-3 py-2">
                  {movement.productName} <span className="font-mono text-xs text-ink-muted">{movement.sku}</span>
                </td>
              )}
              <td className="px-3 py-2">{MOVEMENT_TYPE_LABELS[movement.type as keyof typeof MOVEMENT_TYPE_LABELS] ?? movement.type}</td>
              <td className={`px-3 py-2 text-right font-mono ${movement.quantity < 0 ? "text-red-700" : "text-green-800"}`}>
                {movement.quantity > 0 ? `+${movement.quantity}` : movement.quantity}
              </td>
              <td className="px-3 py-2 text-right font-mono">{movement.onHandAfter}</td>
              <td className="px-3 py-2">{movement.reason}</td>
              <td className="px-3 py-2">{movement.actorName ?? "—"}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
