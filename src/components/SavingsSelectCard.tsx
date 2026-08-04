import { CATEGORY_META } from "@/utils/category";
import { formatCents } from "@/utils/currency";

type Props = {
  savingsTotalCents: number;
  contributedThisMonth: number;
  percentage: number;
  selected: boolean;
  onSelect: () => void;
};

export default function SavingsSelectCard({
  savingsTotalCents,
  contributedThisMonth,
  percentage,
  selected,
  onSelect,
}: Props) {
  const meta = CATEGORY_META.ahorro;

  return (
    <button
      type="button"
      onClick={onSelect}
      aria-pressed={selected}
      className={`w-full rounded-2xl border-2 p-4 text-left transition ${meta.bg} ${
        selected ? meta.selectedBorder : "border-stone-200"
      }`}
    >
      <div className="flex items-center justify-between">
        <p className={`text-sm font-medium ${meta.text}`}>{meta.label}</p>
        <span className="text-xs text-stone-400">
          {percentage}% · {formatCents(contributedThisMonth)}
        </span>
      </div>

      <p className="mt-1 text-xl font-semibold text-stone-900">
        {formatCents(savingsTotalCents)}
        <span className="ml-1 text-sm font-normal text-stone-400">disponible</span>
      </p>

      <p className="mt-1 text-xs text-stone-400">
        +{formatCents(contributedThisMonth)} este mes
      </p>
    </button>
  );
}
