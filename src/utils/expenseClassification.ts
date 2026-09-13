import type { CreditCardPayment } from "@/types/creditCard";
import type { Category, ExpenseTransaction } from "@/types/transaction";

export type OutflowClassification =
  | "owned-consumption"
  | "loan-consumption"
  | "card-consumption"
  | "card-interest"
  | "debt-payment";

export type OutflowTotals = Record<OutflowClassification, number>;

export const EMPTY_OUTFLOW_TOTALS: OutflowTotals = {
  "owned-consumption": 0,
  "loan-consumption": 0,
  "card-consumption": 0,
  "card-interest": 0,
  "debt-payment": 0,
};

export type FinancialOutflow = ExpenseTransaction | CreditCardPayment;

/**
 * Clasifica cada salida una sola vez. El orden es intencional: un pago de
 * préstamo no debe confundirse con consumo y los intereses no deben quedar
 * escondidos entre las compras ordinarias de tarjeta.
 */
export function classifyOutflow(
  outflow: FinancialOutflow,
): OutflowClassification {
  if (!("type" in outflow)) return "debt-payment";
  if (outflow.loanPaymentId) return "debt-payment";
  if (outflow.creditCardChargeKind === "interest-fees") {
    return "card-interest";
  }
  if (outflow.fundedByLoanId) return "loan-consumption";
  if (outflow.creditCardId) return "card-consumption";
  return "owned-consumption";
}

export function isConsumptionExpense(tx: ExpenseTransaction): boolean {
  return classifyOutflow(tx) !== "debt-payment";
}

export function summarizeOutflows(
  outflows: readonly FinancialOutflow[],
): OutflowTotals {
  const totals = { ...EMPTY_OUTFLOW_TOTALS };
  for (const outflow of outflows) {
    totals[classifyOutflow(outflow)] += outflow.amountCents;
  }
  return totals;
}

export function getConsumptionTotalCents(totals: OutflowTotals): number {
  return (
    totals["owned-consumption"] +
    totals["loan-consumption"] +
    totals["card-consumption"] +
    totals["card-interest"]
  );
}

export function getConsumptionByCategory(
  expenses: readonly ExpenseTransaction[],
): Record<Category, number> {
  const totals: Record<Category, number> = {
    necesidad: 0,
    ocio: 0,
    ahorro: 0,
  };
  for (const expense of expenses) {
    if (isConsumptionExpense(expense)) {
      totals[expense.category] += expense.amountCents;
    }
  }
  return totals;
}
