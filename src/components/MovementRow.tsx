import { CATEGORY_META } from "@/utils/category";
import { formatCents } from "@/utils/currency";
import { formatDateLabel } from "@/utils/date";
import type { MovementWithId } from "@/services/movementService";
import type { Category } from "@/types/transaction";

export default function MovementRow({
  movement,
}: {
  movement: MovementWithId;
}) {
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
