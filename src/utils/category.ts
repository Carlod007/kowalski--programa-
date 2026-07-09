// src/utils/category.ts
import type { Category } from "@/types/transaction";

export const CATEGORY_ORDER: Category[] = ["necesidad", "ocio", "ahorro"];

type CategoryMeta = {
  label: string;
  bar: string;
  text: string;
  bg: string;
  selectedBorder: string;
};

export const CATEGORY_META: Record<Category, CategoryMeta> = {
  necesidad: {
    label: "Necesidad",
    bar: "bg-amber-500",
    text: "text-amber-700",
    bg: "bg-amber-50",
    selectedBorder: "border-amber-500",
  },
  ocio: {
    label: "Ocio",
    bar: "bg-blue-500",
    text: "text-blue-700",
    bg: "bg-blue-50",
    selectedBorder: "border-blue-500",
  },
  ahorro: {
    label: "Ahorro",
    bar: "bg-teal-500",
    text: "text-teal-700",
    bg: "bg-teal-50",
    selectedBorder: "border-teal-500",
  },
};

export type CategoryStatus = {
  disponible: number;
  isEmpty: boolean;
  isLow: boolean;
  overCap: boolean;
  barWidth: number;
};

export function getCategoryStatus(
  capCents: number,
  spentCents: number,
): CategoryStatus {
  if (capCents === 0) {
    return {
      disponible: 0,
      isEmpty: true,
      isLow: false,
      overCap: false,
      barWidth: 0,
    };
  }

  const disponible = capCents - spentCents;
  const overCap = spentCents > capCents;
  const isLow = disponible <= capCents * 0.15;
  const barWidth = Math.min(100, Math.max(0, (spentCents / capCents) * 100));

  return { disponible, isEmpty: false, isLow, overCap, barWidth };
}
