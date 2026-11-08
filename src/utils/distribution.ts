import type { Distribution, IncomeTransaction } from "../types/transaction";

export function isValidDistributionPercentage(
  value: unknown,
): value is Distribution {
  if (!value || typeof value !== "object") return false;
  const candidate = value as Record<string, unknown>;
  const keys = Object.keys(candidate);
  if (
    keys.length !== 3 ||
    !keys.includes("necesidad") ||
    !keys.includes("ocio") ||
    !keys.includes("ahorro")
  ) {
    return false;
  }
  const parts = [candidate.necesidad, candidate.ocio, candidate.ahorro];
  if (
    !parts.every(
      (n): n is number =>
        typeof n === "number" && Number.isInteger(n) && n >= 0 && n <= 100,
    )
  ) {
    return false;
  }
  return parts[0] + parts[1] + parts[2] === 100;
}

export function distributionsEqual(a: Distribution, b: Distribution): boolean {
  return (
    a.necesidad === b.necesidad &&
    a.ocio === b.ocio &&
    a.ahorro === b.ahorro
  );
}

export function formatDistributionShort(distribution: Distribution): string {
  return `${distribution.necesidad}/${distribution.ocio}/${distribution.ahorro}`;
}

export function calculateDistribution(
  incomeCents: number,
  distribution: Distribution,
): Distribution {
  const necesidad = Math.floor((incomeCents * distribution.necesidad) / 100);
  const ocio = Math.floor((incomeCents * distribution.ocio) / 100);
  const ahorro = incomeCents - necesidad - ocio;

  return { necesidad, ocio, ahorro };
}

export function isMixedInitialSplit(
  incomes: ReadonlyArray<
    Pick<IncomeTransaction, "amountCents" | "distribution" | "isDirectSavings">
  >,
  monthDistribution: Distribution,
): boolean {
  const distributed = incomes.filter((tx) => !tx.isDirectSavings);
  if (distributed.length === 0) return false;
  return distributed.some(
    (tx) =>
      !distributionsEqual(
        tx.distribution,
        calculateDistribution(tx.amountCents, monthDistribution),
      ),
  );
}

export function calculateMinimumNecesidadPercentage(
  fixedIncomesCents: number,
  essentialNeedsCents: number,
): number {
  if (fixedIncomesCents <= 0) return 0;
  return Math.ceil((essentialNeedsCents / fixedIncomesCents) * 100);
}

export type MinimumNecesidadRecommendation =
  | {
      percentage: number;
      basis: "fixed-income" | "reference-income";
      basisCents: number;
    }
  | {
      percentage: null;
      basis: null;
      basisCents: 0;
    };

/**
 * Decide con qué ingreso se puede calcular el mínimo recomendado.
 * Los ingresos fijos siempre tienen prioridad; la referencia es solo una
 * alternativa temporal para pantallas de configuración.
 */
export function getMinimumNecesidadRecommendation(
  fixedIncomesCents: number,
  essentialNeedsCents: number,
  referenceIncomeCents = 0,
): MinimumNecesidadRecommendation {
  const basis =
    fixedIncomesCents > 0
      ? "fixed-income"
      : referenceIncomeCents > 0
        ? "reference-income"
        : null;
  const basisCents =
    basis === "fixed-income"
      ? fixedIncomesCents
      : basis === "reference-income"
        ? referenceIncomeCents
        : 0;

  if (basis === null) {
    return { percentage: null, basis: null, basisCents: 0 };
  }

  return {
    percentage: calculateMinimumNecesidadPercentage(
      basisCents,
      essentialNeedsCents,
    ),
    basis,
    basisCents,
  };
}

export function calculateProportionalSplit(
  newAmountCents: number,
  originalAmountCents: number,
  originalDistribution: Distribution,
): Distribution {
  const necesidadShare =
    originalAmountCents > 0
      ? originalDistribution.necesidad / originalAmountCents
      : 0;
  const ocioShare =
    originalAmountCents > 0
      ? originalDistribution.ocio / originalAmountCents
      : 0;

  const necesidad = Math.floor(newAmountCents * necesidadShare);
  const ocio = Math.floor(newAmountCents * ocioShare);
  const ahorro = newAmountCents - necesidad - ocio;

  return { necesidad, ocio, ahorro };
}
