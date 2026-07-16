import type { ReactNode } from "react";
import { formatCents } from "@/utils/currency";

type RankedBarProps = {
  label: ReactNode;
  valueCents: number;
  maxCents: number;
  colorClass: string;
};

export default function RankedBar({ label, valueCents, maxCents, colorClass }: RankedBarProps) {
  const width = maxCents > 0 ? Math.min(100, (valueCents / maxCents) * 100) : 0;

  return (
    <div>
      <div className="flex items-center justify-between text-sm">
        <span className="font-medium text-stone-900">{label}</span>
        <span className="text-stone-500">{formatCents(valueCents)}</span>
      </div>
      <div className="mt-1.5 h-2 w-full overflow-hidden rounded-full bg-stone-200">
        <div className={`h-full rounded-full ${colorClass}`} style={{ width: `${width}%` }} />
      </div>
    </div>
  );
}
