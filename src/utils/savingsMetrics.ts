import type { Month, MonthCaps } from "@/types/month";
import type { ExpenseTransaction } from "@/types/transaction";
import type { Movement } from "@/types/movement";
import { getMonthRemainders } from "@/utils/monthRemainders";

export type MonthSavingsMetrics = {
  /** a) Entradas a Ahorro del mes: reparto inicial + directos + traslados hacia Ahorro + (cerrado ? ocioToAhorroCents : 0) */
  inflowsCents: number | null;
  /** b) Salidas de Ahorro del mes: traslados fuera + compras de metas + retiros de fondos + pagos de deuda desde Ahorro */
  outflowsCents: number | null;
  /** c) Flujo neto de Ahorro del mes = a - b */
  netFlowCents: number | null;
  /** d) Numerador de la tasa de ahorro efectiva = flujo neto sin aportes directos */
  netWithoutDirectCents: number | null;
  /** d) Tasa de ahorro efectiva del mes en texto con 1 decimal (ej. "18.5") o null si no aplica */
  effectiveSavingsRatePct: string | null;
  isRateDeterminable: boolean;
  /** Desglose de entradas/salidas */
  initialSplitAhorroCents: number;
  directSavingsCents: number;
  movedToAhorroCents: number;
  movedOutOfAhorroCents: number;
  ahorroExpensesCents: number;
  closingOcioToAhorroCents: number;
  untrackedCents: number;
  isUntrackedDeterminable: boolean;
  /** Déficit pendiente en Necesidad u Ocio (ownedCap - ownedSpent < 0 en alguno o netDeficitCents > 0) */
  hasEnvelopeDeficit: boolean;
  envelopeDeficitWarning: string | null;
};

export const SAVINGS_DEFICIT_WARNING_COPY =
  "Este mes gastaste más de lo que ingresó; el ahorro mostrado no refleja ese déficit";

export type ComputeMonthSavingsMetricsInput = {
  month: Pick<
    Month,
    | "ahorroContributedCents"
    | "totalIncomeCents"
    | "directSavingsCents"
    | "closed"
    | "remainder"
    | "capsCents"
    | "spentCents"
    | "borrowedCapsCents"
    | "loanFundedSpentCents"
  >;
  initialSplitAhorroCents: number;
  isInitialSplitDeterminable: boolean;
  movements: Movement[] | null;
  expenses: ExpenseTransaction[] | null;
};

export function hasMonthEnvelopeDeficit(
  month: Pick<
    Month,
    | "capsCents"
    | "spentCents"
    | "borrowedCapsCents"
    | "loanFundedSpentCents"
    | "closed"
    | "remainder"
  >,
): boolean {
  const borrowedCaps: MonthCaps = month.borrowedCapsCents ?? {
    necesidad: 0,
    ocio: 0,
  };
  const loanFundedSpent: MonthCaps = month.loanFundedSpentCents ?? {
    necesidad: 0,
    ocio: 0,
  };
  const necOwnedCap = Math.max(
    0,
    month.capsCents.necesidad - borrowedCaps.necesidad,
  );
  const necOwnedSpent = Math.max(
    0,
    month.spentCents.necesidad - loanFundedSpent.necesidad,
  );
  const ocioOwnedCap = Math.max(0, month.capsCents.ocio - borrowedCaps.ocio);
  const ocioOwnedSpent = Math.max(
    0,
    month.spentCents.ocio - loanFundedSpent.ocio,
  );

  const rawNec = necOwnedCap - necOwnedSpent;
  const rawOcio = ocioOwnedCap - ocioOwnedSpent;

  if (month.closed) {
    const computed = getMonthRemainders(month);
    const netDeficit =
      month.remainder?.netDeficitCents ?? computed.netDeficitCents;
    return netDeficit > 0 || rawNec < 0 || rawOcio < 0;
  }

  return rawNec < 0 || rawOcio < 0;
}

/**
 * Única fuente de verdad para las métricas de Ahorro de un mes:
 * a) Entradas = reparto inicial real + aportes directos + traslados hacia Ahorro + (cerrado ? ocioToAhorroCents : 0) + ajuste legacy positivo si existiera
 * b) Salidas = traslados fuera de Ahorro + compras de metas + retiros de fondos + pagos de deuda desde Ahorro
 * c) Flujo neto = a - b
 * d) Tasa de ahorro efectiva = (flujo neto sin aportes directos) / totalIncomeCents
 */
export function computeMonthSavingsMetrics(
  input: ComputeMonthSavingsMetricsInput,
): MonthSavingsMetrics {
  const {
    month,
    initialSplitAhorroCents,
    isInitialSplitDeterminable,
    movements,
    expenses,
  } = input;

  const directSavingsCents = month.directSavingsCents ?? 0;
  const hasEnvelopeDeficit = hasMonthEnvelopeDeficit(month);
  const envelopeDeficitWarning = hasEnvelopeDeficit
    ? SAVINGS_DEFICIT_WARNING_COPY
    : null;

  const movedToAhorroCents = (movements ?? [])
    .filter((m) => m.destination === "ahorro")
    .reduce((sum, m) => sum + m.amountCents, 0);
  const movedOutOfAhorroCents = (movements ?? [])
    .filter((m) => m.origin === "ahorro")
    .reduce((sum, m) => sum + m.amountCents, 0);

  const ahorroExpenses = (expenses ?? []).filter(
    (tx) => tx.category === "ahorro",
  );
  const ahorroExpensesCents = ahorroExpenses.reduce(
    (sum, tx) => sum + tx.amountCents,
    0,
  );

  const closingOcioRaw = month.closed
    ? month.remainder?.ocioToAhorroCents
    : 0;
  const isClosingDeterminable = Number.isInteger(closingOcioRaw);
  const closingOcioToAhorroCents = isClosingDeterminable ? closingOcioRaw! : 0;

  // Diferencia entre ahorroContributedCents y las entradas conocidas del mes.
  // - Documentos anteriores a F3 no decrementaban ahorroContributedCents al
  //   sacar dinero de Ahorro (rawInputsWithoutOut).
  // - Documentos desde F3 sí decrementan ahorroContributedCents al trasladar
  //   fuera de Ahorro (hasta 0).
  // Solo existe un ajuste no registrado si ahorroContributedCents no coincide
  // con ninguna de esas dos contabilizaciones válidas.
  const rawInputsWithoutOut =
    initialSplitAhorroCents + movedToAhorroCents + directSavingsCents;
  const expectedContributedWithOut = Math.max(
    0,
    rawInputsWithoutOut - movedOutOfAhorroCents,
  );
  const matchesF3Contributed =
    month.ahorroContributedCents === expectedContributedWithOut;
  const matchesLegacyContributed =
    month.ahorroContributedCents === rawInputsWithoutOut;

  const untrackedCents =
    matchesF3Contributed || matchesLegacyContributed
      ? 0
      : month.ahorroContributedCents - rawInputsWithoutOut;
  const isUntrackedDeterminable =
    isInitialSplitDeterminable && untrackedCents >= 0;

  const validMovementAmounts =
    movements !== null &&
    movements.every(
      (m) => Number.isInteger(m.amountCents) && m.amountCents >= 0,
    );
  const validExpenseAmounts =
    expenses !== null &&
    ahorroExpenses.every(
      (tx) => Number.isInteger(tx.amountCents) && tx.amountCents >= 0,
    );

  const canComputeFullFlow =
    isInitialSplitDeterminable &&
    isUntrackedDeterminable &&
    isClosingDeterminable &&
    validMovementAmounts &&
    validExpenseAmounts &&
    Number.isInteger(month.ahorroContributedCents);

  if (!canComputeFullFlow) {
    return {
      inflowsCents: null,
      outflowsCents: null,
      netFlowCents: null,
      netWithoutDirectCents: null,
      effectiveSavingsRatePct: null,
      isRateDeterminable: false,
      initialSplitAhorroCents,
      directSavingsCents,
      movedToAhorroCents,
      movedOutOfAhorroCents,
      ahorroExpensesCents,
      closingOcioToAhorroCents,
      untrackedCents,
      isUntrackedDeterminable,
      hasEnvelopeDeficit,
      envelopeDeficitWarning,
    };
  }

  // a) Entradas del mes (incluye untrackedCents legacy si > 0 para conservar el centavo exacto)
  const inflowsCents =
    initialSplitAhorroCents +
    directSavingsCents +
    movedToAhorroCents +
    closingOcioToAhorroCents +
    untrackedCents;

  // b) Salidas del mes
  const outflowsCents = movedOutOfAhorroCents + ahorroExpensesCents;

  // c) Flujo neto del mes = a - b
  const netFlowCents = inflowsCents - outflowsCents;

  // d) Tasa de ahorro efectiva del mes = (flujo neto sin aportes directos) / totalIncomeCents
  const netWithoutDirectCents = netFlowCents - directSavingsCents;
  const isRateDeterminable = isInitialSplitDeterminable && untrackedCents === 0;
  const effectiveSavingsRatePct =
    isRateDeterminable && month.totalIncomeCents > 0
      ? ((netWithoutDirectCents / month.totalIncomeCents) * 100).toFixed(1)
      : null;

  return {
    inflowsCents,
    outflowsCents,
    netFlowCents,
    netWithoutDirectCents,
    effectiveSavingsRatePct,
    isRateDeterminable,
    initialSplitAhorroCents,
    directSavingsCents,
    movedToAhorroCents,
    movedOutOfAhorroCents,
    ahorroExpensesCents,
    closingOcioToAhorroCents,
    untrackedCents,
    isUntrackedDeterminable,
    hasEnvelopeDeficit,
    envelopeDeficitWarning,
  };
}
