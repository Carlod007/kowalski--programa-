// src/components/CategorySelectCard.tsx
import type { Category } from '@/types/transaction'
import { CATEGORY_META, getCategoryStatus } from '@/utils/category'
import { formatCents } from '@/utils/currency'
import CategoryIcon from '@/components/CategoryIcon'

type Props = {
  category: Category
  capCents: number
  spentCents: number
  selected: boolean
  onSelect: (category: Category) => void
}

export default function CategorySelectCard({ category, capCents, spentCents, selected, onSelect }: Props) {
  const meta = CATEGORY_META[category]
  const status = getCategoryStatus(capCents, spentCents)

  return (
    <button
      type="button"
      onClick={() => onSelect(category)}
      aria-pressed={selected}
      className={`w-full rounded-2xl border-2 border-stone-200 p-4 text-left transition ${meta.bg}`}
    >
      <div className="flex items-center gap-3">
        <CategoryIcon category={category} />
        <p className={`text-base font-semibold ${meta.text}`}>{meta.label}</p>
        {status.overCap && (
          <span className="ml-auto rounded-full bg-red-100 px-2 py-0.5 text-xs font-medium text-red-700">
            Excedido
          </span>
        )}
      </div>

      {status.isEmpty ? (
        <p className="mt-3 text-sm text-stone-500">Aún sin ingresos registrados</p>
      ) : (
        <>
          <p className={`mt-3 text-xl font-semibold ${status.isLow ? 'text-red-600' : 'text-stone-900'}`}>
            {formatCents(status.disponible)}
            <span className="ml-1 text-sm font-normal text-stone-400">disponible</span>
          </p>

          <div className="mt-3 h-2 w-full overflow-hidden rounded-full bg-stone-200">
            <div
              className={`h-full rounded-full ${status.overCap ? 'bg-red-500' : meta.bar}`}
              style={{ width: `${status.barWidth}%` }}
            />
          </div>

          <p className="mt-2 text-xs text-stone-400">
            {formatCents(spentCents)} de {formatCents(capCents)}
          </p>
        </>
      )}
    </button>
  )
}