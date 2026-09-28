import type { ExpenseTransaction } from "@/types/transaction";
import type { SubcategoryBudget } from "@/types/user";
import { isConsumptionExpense } from "@/utils/expenseClassification";
import { formatCents } from "@/utils/currency";

export type SubcategoryBudgetLevel = "ok" | "near" | "exceeded";

export type SubcategoryBudgetStatus = {
  spentCents: number;
  projectedCents: number;
  remainingCents: number;
  percentage: number;
  level: SubcategoryBudgetLevel;
};

export function getSubcategoryBudgetKey(
  category: "necesidad" | "ocio",
  subcategory: string,
): string {
  return `${category}\u0000${subcategory}`;
}

export function getSubcategoryConsumptionCents(
  expenses: readonly ExpenseTransaction[],
  budget: Pick<SubcategoryBudget, "category" | "subcategory">,
): number {
  return expenses.reduce(
    (total, expense) =>
      isConsumptionExpense(expense) &&
      expense.category === budget.category &&
      expense.subcategory === budget.subcategory
        ? total + expense.amountCents
        : total,
    0,
  );
}

export function getSubcategoryBudgetStatus(
  monthlyLimitCents: number,
  spentCents: number,
  proposedCents = 0,
): SubcategoryBudgetStatus {
  const safeLimit = Math.max(1, monthlyLimitCents);
  const projectedCents = Math.max(0, spentCents + proposedCents);
  const percentage = Math.round((projectedCents / safeLimit) * 100);
  return {
    spentCents,
    projectedCents,
    remainingCents: monthlyLimitCents - projectedCents,
    percentage,
    level: percentage >= 100 ? "exceeded" : percentage >= 80 ? "near" : "ok",
  };
}

/** Texto informativo del objetivo, sin alterar el consumo calculado. */
export function getSubcategoryObjectiveCopy(
  subcategory: string,
  monthlyLimitCents: number,
  status: SubcategoryBudgetStatus,
  hasAmount: boolean,
): { primary: string; showClarification: boolean } {
  const spent = formatCents(status.projectedCents);
  const goal = formatCents(monthlyLimitCents);
  const overBy = -status.remainingCents;
  const showClarification = status.level === "near" || overBy > 0;

  if (hasAmount) {
    const prefix = `Con este gasto: ${spent} de ${goal} en ${subcategory}.`;
    return {
      primary: overBy > 0
        ? `${prefix} Superado por ${formatCents(overBy)}.`
        : status.remainingCents === 0
          ? `${prefix} Objetivo alcanzado.`
          : status.level === "near"
            ? `${prefix} Faltan ${formatCents(status.remainingCents)} para el objetivo mensual de ${subcategory}.`
            : prefix,
      showClarification,
    };
  }

  if (overBy > 0) {
    return {
      primary: `Objetivo mensual de ${subcategory}: ${spent} de ${goal}. Superado por ${formatCents(overBy)}.`,
      showClarification,
    };
  }
  if (status.remainingCents === 0) {
    return {
      primary: `Alcanzaste el objetivo mensual de ${subcategory}: ${spent} de ${goal}.`,
      showClarification,
    };
  }
  if (status.level === "near") {
    return {
      primary: `Llevas ${spent} de ${goal}. Faltan ${formatCents(status.remainingCents)} para el objetivo mensual de ${subcategory}.`,
      showClarification,
    };
  }
  return {
    primary: `Objetivo mensual de ${subcategory}: ${spent} de ${goal}.`,
    showClarification,
  };
}
