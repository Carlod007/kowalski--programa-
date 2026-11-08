import { CATEGORY_META } from "@/utils/category";
import { formatCents } from "@/utils/currency";
import { formatDateLabel, formatMonthLabel } from "@/utils/date";
import type { MovementWithId } from "@/services/movementService";
import type { Category } from "@/types/transaction";

export default function MovementRow({
  movement,
}: {
  movement: MovementWithId;
}) {
  if (movement.kind === "closed_month_adjustment") {
    const cat = (movement.category ?? movement.destination) as Category;
    const catMeta = CATEGORY_META[cat];
    const delta = movement.deltaCents ?? movement.amountCents;
    const isPositive = delta >= 0;

    return (
      <div className="rounded-2xl border border-stone-200 bg-white p-4">
        <div className="flex items-center justify-between gap-2">
          <div className="flex flex-wrap items-center gap-1.5 text-sm font-medium text-stone-900">
            <span className="rounded-full bg-amber-100 px-2 py-0.5 text-xs font-medium text-amber-800">
              Ajuste{" "}
              {movement.referenceMonthId
                ? formatMonthLabel(movement.referenceMonthId)
                : "mes cerrado"}
            </span>
            <span className={catMeta.text}>{catMeta.label}</span>
          </div>
          <span
            className={`text-sm font-semibold ${
              isPositive ? "text-teal-700" : "text-red-600"
            }`}
          >
            {isPositive ? "+" : "−"}
            {formatCents(Math.abs(delta))}
          </span>
        </div>
        <p className="mt-1 text-xs text-stone-400">
          {formatDateLabel(movement.transactionDate)}
        </p>
        {movement.reason && (
          <p className="mt-1 text-xs text-stone-500">{movement.reason}</p>
        )}
      </div>
    );
  }

  const originMeta = CATEGORY_META[movement.origin as Category];
  const destMeta = CATEGORY_META[movement.destination as Category];

  return (
    <div className="rounded-2xl border border-stone-200 bg-white p-4">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2 text-sm font-medium text-stone-900">
          <span className={originMeta.text}>{originMeta.label}</span>
          <span className="text-stone-400">→</span>
          <span className={destMeta.text}>{destMeta.label}</span>
        </div>
        <span className="text-sm font-semibold text-teal-700">
          {formatCents(movement.amountCents)}
        </span>
      </div>
      <p className="mt-1 text-xs text-stone-400">
        {formatDateLabel(movement.transactionDate)}
      </p>
      {movement.reason && (
        <p className="mt-1 text-xs text-stone-500">{movement.reason}</p>
      )}
    </div>
  );
}
