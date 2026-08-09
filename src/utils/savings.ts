import type { GoalKind, SavingsGoal } from "@/types/user";

/**
 * Reglas de reparto del ahorro entre metas.
 *
 * Invariante: savingsTotalCents es la única fuente de verdad de cuánta plata
 * hay. Lo asignado a metas es una etiqueta sobre esa misma plata, nunca un
 * saldo aparte. Por eso "sin asignar" SIEMPRE se calcula (total - asignado) y
 * nunca se guarda: savingsTotalCents se modifica desde nueve lugares distintos
 * (ingresos, egresos, cierre de mes, mover excedente, comprar meta) y guardar
 * un espejo obligaría a actualizarlo en todos ellos - una omisión corrompería
 * plata en silencio.
 */

/** Metas creadas antes de esta función no tienen kind: son de compra. */
export function getGoalKind(goal: SavingsGoal): GoalKind {
  return goal.kind ?? "compra";
}

/** Metas creadas antes de esta función no tienen asignado: arrancan en 0. */
export function getGoalAllocated(goal: SavingsGoal): number {
  return goal.allocatedCents ?? 0;
}

export function getAllocatedTotal(goals: SavingsGoal[]): number {
  return goals.reduce((sum, g) => sum + getGoalAllocated(g), 0);
}

/**
 * Plata del ahorro que no está reservada para ninguna meta. Puede dar negativo
 * si el ahorro total bajó después de asignar (por ejemplo al borrar un ingreso
 * mal cargado). Ese caso NO se corrige solo: se muestra como "sobreasignado"
 * para que el usuario decida qué meta ajustar.
 */
export function getUnassignedCents(
  savingsTotalCents: number,
  goals: SavingsGoal[],
): number {
  return savingsTotalCents - getAllocatedTotal(goals);
}

export function isOverAllocated(
  savingsTotalCents: number,
  goals: SavingsGoal[],
): boolean {
  return getUnassignedCents(savingsTotalCents, goals) < 0;
}

/** Lo asignable de verdad: nunca negativo, para no ofrecer plata inexistente. */
export function getAssignableCents(
  savingsTotalCents: number,
  goals: SavingsGoal[],
): number {
  return Math.max(0, getUnassignedCents(savingsTotalCents, goals));
}

export function getPurchaseCount(goal: SavingsGoal): number {
  return goal.purchaseCount ?? 0;
}

/** Una meta figura como comprada mientras le quede al menos una compra viva. */
export function wasPurchased(goal: SavingsGoal): boolean {
  return getPurchaseCount(goal) > 0;
}

export type GoalProgress = {
  kind: GoalKind;
  allocatedCents: number;
  targetCents: number;
  /** Cuánto falta asignar para completar la meta (0 si ya está completa). */
  missingCents: number;
  isComplete: boolean;
  barWidth: number;
  /** Una meta de compra solo se puede gastar completa y ya juntada. */
  canPurchase: boolean;
  /** Un fondo se puede retirar de a partes apenas tenga algo asignado. */
  canWithdraw: boolean;
};

export function getGoalProgress(goal: SavingsGoal): GoalProgress {
  const kind = getGoalKind(goal);
  const allocatedCents = getGoalAllocated(goal);
  const targetCents = goal.targetCents;
  const isComplete = allocatedCents >= targetCents;
  const barWidth =
    targetCents <= 0
      ? 0
      : Math.min(100, Math.max(0, (allocatedCents / targetCents) * 100));

  return {
    kind,
    allocatedCents,
    targetCents,
    missingCents: Math.max(0, targetCents - allocatedCents),
    isComplete,
    barWidth,
    canPurchase: kind === "compra" && isComplete,
    canWithdraw: kind === "fondo" && allocatedCents > 0,
  };
}
