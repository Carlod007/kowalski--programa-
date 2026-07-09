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
