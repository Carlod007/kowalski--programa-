import { useEffect, useState } from "react";
import {
  getMonthMovements,
  getMonthInitialSplit,
  type MovementWithId,
} from "@/services/movementService";
import { getMonthExpenses } from "@/services/analyticsService";
import { isMixedInitialSplit } from "@/utils/distribution";
import {
  computeMonthSavingsMetrics,
  type MonthSavingsMetrics,
} from "@/utils/savingsMetrics";
import type { Month } from "@/types/month";
import type {
  Distribution,
  ExpenseTransaction,
  IncomeTransaction,
} from "@/types/transaction";

export type AhorroBreakdown = {
  movements: MovementWithId[];
  movementsReady: boolean;
  expenses: ExpenseTransaction[] | null;
  initialSplitAhorroCents: number;
  isInitialSplitDeterminable: boolean;
  isMixedSplit: boolean;
  movedToAhorroCents: number;
  movedOutOfAhorroCents: number;
  ahorroExpensesCents: number;
  closingOcioToAhorroCents: number;
  closingNecesidadToAhorroCents: number;
  untrackedCents: number;
  isUntrackedDeterminable: boolean;
  inflowsCents: number | null;
  outflowsCents: number | null;
  netFlowCents: number | null;
  netContributionCents: number;
  ahorroActualPct: string | null;
  isAhorroActualDeterminable: boolean;
  hasEnvelopeDeficit: boolean;
  envelopeDeficitWarning: string | null;
  metrics: MonthSavingsMetrics;
};

/**
 * Desglose unificado del flujo de Ahorro de un mes basado en
 * computeMonthSavingsMetrics (src/utils/savingsMetrics.ts). Compartido entre
 * Dashboard y Movements para garantizar que ambas pantallas coincidan al centavo.
 */
export function useAhorroBreakdown(
  userId: string,
  monthId: string,
  ahorroContributedCents: number,
  totalIncomeCents: number,
  directSavingsCents: number,
  monthDistribution?: Distribution,
  month?: Month | null,
  externalExpenses?: ExpenseTransaction[] | null,
): AhorroBreakdown {
  const [movements, setMovements] = useState<MovementWithId[]>([]);
  const [loadedMonth, setLoadedMonth] = useState<string | null>(null);
  const [initialSplitAhorroCents, setInitialSplitAhorroCents] = useState(0);
  const [isInitialSplitDeterminable, setIsInitialSplitDeterminable] =
    useState(true);
  const [distributedIncomes, setDistributedIncomes] = useState<
    IncomeTransaction[]
  >([]);
  const [internalExpenses, setInternalExpenses] = useState<
    ExpenseTransaction[] | null
  >(null);

  useEffect(() => {
    const unsubMovements = getMonthMovements(
      userId,
      monthId,
      (items) => {
        setMovements(items);
        setLoadedMonth(`${userId}/${monthId}`);
      },
      () => setLoadedMonth(null),
    );
    const unsubInitialSplit = getMonthInitialSplit(
      userId,
      monthId,
      (split, incomes) => {
        setInitialSplitAhorroCents(split?.ahorro ?? 0);
        setIsInitialSplitDeterminable(split !== null);
        setDistributedIncomes(incomes ?? []);
      },
    );
    return () => {
      unsubMovements();
      unsubInitialSplit();
    };
  }, [userId, monthId]);

  useEffect(() => {
    if (externalExpenses !== undefined) return;
    return getMonthExpenses(
      userId,
      monthId,
      (txs) => setInternalExpenses(txs),
      () => setInternalExpenses(null),
    );
  }, [userId, monthId, externalExpenses]);

  const resolvedExpenses =
    externalExpenses !== undefined ? externalExpenses : internalExpenses;
  const movementsReady = loadedMonth === `${userId}/${monthId}`;

  const isMixedSplit = Boolean(
    monthDistribution &&
      isInitialSplitDeterminable &&
      isMixedInitialSplit(distributedIncomes, monthDistribution),
  );

  const metrics = computeMonthSavingsMetrics({
    month: {
      ahorroContributedCents,
      totalIncomeCents,
      directSavingsCents,
      closed: month?.closed ?? false,
      remainder: month?.remainder,
      capsCents: month?.capsCents ?? { necesidad: 0, ocio: 0 },
      spentCents: month?.spentCents ?? { necesidad: 0, ocio: 0 },
      borrowedCapsCents: month?.borrowedCapsCents,
      loanFundedSpentCents: month?.loanFundedSpentCents,
      carriedDeficitCents: month?.carriedDeficitCents,
    },
    initialSplitAhorroCents,
    isInitialSplitDeterminable,
    movements: movementsReady ? movements : null,
    expenses: resolvedExpenses,
  });

  const netContributionCents =
    metrics.netWithoutDirectCents ??
    metrics.initialSplitAhorroCents +
      metrics.movedToAhorroCents -
      metrics.movedOutOfAhorroCents -
      metrics.ahorroExpensesCents;

  return {
    movements,
    movementsReady,
    expenses: resolvedExpenses,
    initialSplitAhorroCents: metrics.initialSplitAhorroCents,
    isInitialSplitDeterminable,
    isMixedSplit,
    movedToAhorroCents: metrics.movedToAhorroCents,
    movedOutOfAhorroCents: metrics.movedOutOfAhorroCents,
    ahorroExpensesCents: metrics.ahorroExpensesCents,
    closingOcioToAhorroCents: metrics.closingOcioToAhorroCents,
    closingNecesidadToAhorroCents: metrics.closingNecesidadToAhorroCents ?? 0,
    untrackedCents: metrics.untrackedCents,
    isUntrackedDeterminable: metrics.isUntrackedDeterminable,
    inflowsCents: metrics.inflowsCents,
    outflowsCents: metrics.outflowsCents,
    netFlowCents: metrics.netFlowCents,
    netContributionCents,
    ahorroActualPct: metrics.effectiveSavingsRatePct,
    isAhorroActualDeterminable: metrics.isRateDeterminable,
    hasEnvelopeDeficit: metrics.hasEnvelopeDeficit,
    envelopeDeficitWarning: metrics.envelopeDeficitWarning,
    metrics,
  };
}
