import type { Distribution } from "../types/transaction";

export function calculateDistribution(
  incomeCents: number,
  distribution: Distribution,
): Distribution {
  const necesidad = Math.floor((incomeCents * distribution.necesidad) / 100);
  const ocio = Math.floor((incomeCents * distribution.ocio) / 100);
  const ahorro = incomeCents - necesidad - ocio;

  return { necesidad, ocio, ahorro };
}

export function calculateMinimumNecesidadPercentage(
  fixedIncomesCents: number,
  essentialNeedsCents: number,
): number {
  if (fixedIncomesCents <= 0) return 0;
  return Math.ceil((essentialNeedsCents / fixedIncomesCents) * 100);
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
