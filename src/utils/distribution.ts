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

/**
 * % mínimo de Necesidad recomendado para cubrir las necesidades esenciales
 * declaradas sin déficit. Se redondea hacia arriba (Math.ceil) para no
 * quedar corto. Puede superar 100 si las necesidades superan los ingresos
 * fijos: eso se muestra al usuario como déficit, nunca se oculta ni se
 * recorta a 100 en esta función.
 */
export function calculateMinimumNecesidadPercentage(
  fixedIncomesCents: number,
  essentialNeedsCents: number,
): number {
  if (fixedIncomesCents <= 0) return 0;
  return Math.ceil((essentialNeedsCents / fixedIncomesCents) * 100);
}

/**
 * Reparto proporcional al editar el monto de un ingreso ya registrado:
 * preserva la proporción con la que quedó dividido originalmente (derivada
 * de tx.distribution/tx.amountCents), en vez de recalcular con el % actual
 * de distribution.necesidad/ocio/ahorro. Debe ser la ÚNICA implementación
 * de este cálculo — usarla tanto al guardar (transactionService.ts) como en
 * cualquier vista previa, para que nunca muestren cifras distintas.
 */
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
