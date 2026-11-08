import type { Category } from "@/types/transaction";
import type { Month, MonthCaps } from "@/types/month";
import { getMonthRemainders } from "@/utils/monthRemainders";

export const CATEGORY_ORDER: Category[] = ["necesidad", "ocio", "ahorro"];
export const CAP_CATEGORY_ORDER: ("necesidad" | "ocio")[] = [
  "necesidad",
  "ocio",
];

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
    if (spentCents > 0) {
      return {
        disponible: -spentCents,
        isEmpty: false,
        isLow: true,
        overCap: true,
        barWidth: 100,
      };
    }
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

export type CategoryDisplayBalance = {
  amountCents: number;
  label:
    | "disponible"
    | "sobrante transferido a Ahorro"
    | "sobrante heredado al mes siguiente"
    | "excedido al cierre";
  isOverCapAtClose: boolean;
  netDeficitCents: number;
};

/**
 * Devuelve el monto principal y su etiqueta para Necesidad u Ocio en un mes
 * abierto o cerrado. En meses cerrados usa month.remainder (y recurre a
 * getMonthRemainders en meses legacy donde falte necesidadToNextMonthCents o
 * netDeficitCents). Si el sobre cerró en negativo (ownedCap - ownedSpent < 0),
 * muestra el exceso real y la etiqueta "excedido al cierre".
 */
export function getCategoryDisplayBalance(
  category: keyof MonthCaps,
  month: Pick<
    Month,
    | "closed"
    | "capsCents"
    | "spentCents"
    | "borrowedCapsCents"
    | "loanFundedSpentCents"
    | "remainder"
  >,
): CategoryDisplayBalance {
  const borrowedCap = month.borrowedCapsCents?.[category] ?? 0;
  const loanFundedSpent = month.loanFundedSpentCents?.[category] ?? 0;
  const ownedCap = Math.max(0, month.capsCents[category] - borrowedCap);
  const ownedSpent = Math.max(0, month.spentCents[category] - loanFundedSpent);
  const rawBalance = ownedCap - ownedSpent;

  if (!month.closed) {
    return {
      amountCents: rawBalance,
      label: "disponible",
      isOverCapAtClose: false,
      netDeficitCents: 0,
    };
  }

  const computed = getMonthRemainders(month);
  const netDeficitCents =
    month.remainder?.netDeficitCents ?? computed.netDeficitCents;

  if (rawBalance < 0) {
    return {
      amountCents: rawBalance,
      label: "excedido al cierre",
      isOverCapAtClose: true,
      netDeficitCents,
    };
  }

  if (category === "ocio") {
    return {
      amountCents:
        month.remainder?.ocioToAhorroCents ?? computed.ocioToAhorroCents,
      label: "sobrante transferido a Ahorro",
      isOverCapAtClose: false,
      netDeficitCents,
    };
  }

  return {
    amountCents:
      month.remainder?.necesidadToNextMonthCents ??
      computed.necesidadToNextMonthCents,
    label: "sobrante heredado al mes siguiente",
    isOverCapAtClose: false,
    netDeficitCents,
  };
}

// El progreso de una meta ya no se mide contra el ahorro total (eso hacía que
// la misma plata contara para todas las metas a la vez). Ahora se mide contra
// lo asignado a esa meta: ver getGoalProgress en @/utils/savings.
