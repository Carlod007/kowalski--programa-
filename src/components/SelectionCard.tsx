type Props = {
  label: string;
  description: string;
  selected: boolean;
  onSelect: () => void;
};

export default function SelectionCard({
  label,
  description,
  selected,
  onSelect,
}: Props) {
  return (
    <button
      type="button"
      onClick={onSelect}
      aria-pressed={selected}
      className={`w-full rounded-2xl border p-4 text-left transition ${
        selected ? "border-2 border-emerald-600 bg-emerald-50" : "border-stone-200 bg-white"
      }`}
    >
      <p className="text-sm font-medium text-stone-900">{label}</p>
      <p className="mt-1 text-xs text-stone-500">{description}</p>
    </button>
  );
}
