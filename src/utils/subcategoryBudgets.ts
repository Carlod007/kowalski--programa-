import type { ExpenseTransaction } from "@/types/transaction";
import type { SubcategoryBudget } from "@/types/user";
import { isConsumptionExpense } from "@/utils/expenseClassification";

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
