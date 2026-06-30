import type { Distribution } from "../types/transaction";

export function calculateDistribution(incomeCents: number): Distribution {
  const necesidad = Math.floor((incomeCents * 70) / 100);
  const ocio = Math.floor((incomeCents * 10) / 100);
  const ahorro = incomeCents - necesidad - ocio;

  return {
    necesidad,
    ocio,
    ahorro,
  };
}
