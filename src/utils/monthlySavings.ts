import type { Month } from "@/types/month";
import type { ExpenseTransaction } from "@/types/transaction";
import type { Movement } from "@/types/movement";
import { computeMonthSavingsMetrics } from "@/utils/savingsMetrics";

export type MonthlySavingsMonthInput = Pick<
  Month,
  "ahorroContributedCents" | "closed"
> &
  Partial<
    Pick<
      Month,
      | "remainder"
      | "totalIncomeCents"
      | "directSavingsCents"
      | "capsCents"
      | "spentCents"
      | "borrowedCapsCents"
      | "loanFundedSpentCents"
      | "carriedDeficitCents"
    >
  >;

/** Flujo neto del mes, no saldo gastable ni total acumulado. Delega en computeMonthSavingsMetrics. */
export function getMonthlySavingsNet(
  month: MonthlySavingsMonthInput,
  expenses: ExpenseTransaction[] | null,
  movements: Movement[] | null,
  initialSplitAhorroCents?: number,
  isInitialSplitDeterminable = true,
): number | null {
  if (!expenses || !movements) return null;
  if (!Number.isInteger(month.ahorroContributedCents)) return null;
  const movedToAhorro = movements.reduce((sum, m) => {
    if (m.kind === "closed_month_adjustment") {
      return m.category === "ahorro" && (m.deltaCents ?? 0) > 0
        ? sum + (Number.isInteger(m.deltaCents) ? m.deltaCents! : 0)
        : sum;
    }
    return m.destination === "ahorro" && Number.isInteger(m.amountCents)
      ? sum + m.amountCents
      : sum;
  }, 0);
  const direct = month.directSavingsCents ?? 0;
  const fallbackInitialSplit =
    initialSplitAhorroCents ??
    Math.max(0, month.ahorroContributedCents - movedToAhorro - direct);

  const metrics = computeMonthSavingsMetrics({
    month: {
      ahorroContributedCents: month.ahorroContributedCents,
      totalIncomeCents: month.totalIncomeCents ?? 0,
      directSavingsCents: month.directSavingsCents ?? 0,
      closed: month.closed,
      remainder: month.remainder,
      capsCents: month.capsCents ?? { necesidad: 0, ocio: 0 },
      spentCents: month.spentCents ?? { necesidad: 0, ocio: 0 },
      borrowedCapsCents: month.borrowedCapsCents,
      loanFundedSpentCents: month.loanFundedSpentCents,
      carriedDeficitCents: month.carriedDeficitCents,
    },
    initialSplitAhorroCents: fallbackInitialSplit,
    isInitialSplitDeterminable,
    movements,
    expenses,
  });

  return metrics.netFlowCents;
}
