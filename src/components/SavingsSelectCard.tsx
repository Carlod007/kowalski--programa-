import { CATEGORY_META } from "@/utils/category";
import { formatCents } from "@/utils/currency";
import CategoryIcon from "@/components/CategoryIcon";

type Props = {
  savingsTotalCents: number;
  contributedThisMonth: number;
  selected: boolean;
  onSelect: () => void;
};

export default function SavingsSelectCard({
  savingsTotalCents,
  contributedThisMonth,
  selected,
  onSelect,
}: Props) {
  const meta = CATEGORY_META.ahorro;

  return (
    <button
      type="button"
      onClick={onSelect}
      aria-pressed={selected}
      className={`w-full rounded-2xl border-2 border-stone-200 p-4 text-left transition ${meta.bg}`}
    >
      <div className="flex items-center gap-3">
        <CategoryIcon category="ahorro" />
        <p className={`text-base font-semibold ${meta.text}`}>{meta.label}</p>
      </div>

      <p className="mt-3 text-xl font-semibold text-stone-900">
        {formatCents(savingsTotalCents)}
        <span className="ml-1 text-sm font-normal text-stone-400">disponible</span>
      </p>

      <p className="mt-2 text-xs text-stone-400">
        +{formatCents(contributedThisMonth)} este mes
      </p>
    </button>
  );
}
