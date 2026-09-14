import { describe, expect, it } from "vitest";
import type { ExpenseTransaction } from "@/types/transaction";
import {
  getSubcategoryBudgetStatus,
  getSubcategoryConsumptionCents,
} from "./subcategoryBudgets";

function expense(
  amountCents: number,
  overrides: Partial<ExpenseTransaction> = {},
): ExpenseTransaction {
  return {
    type: "expense",
    category: "ocio",
    subcategory: "Comida",
    paymentMethod: "Yape",
    amountCents,
    localDate: "2026-09-13",
    transactionDate: "2026-09-13",
    serverDate: null,
    ...overrides,
  };
}

describe("presupuesto por subcategoría", () => {
  it("cuenta consumo propio, préstamo y tarjeta una sola vez", () => {
    const spent = getSubcategoryConsumptionCents(
      [
        expense(100),
        expense(200, { fundedByLoanId: "loan" }),
        expense(300, { creditCardId: "card" }),
        expense(400, { loanPaymentId: "payment", loanId: "loan" }),
      ],
      { category: "ocio", subcategory: "Comida" },
    );
    expect(spent).toBe(600);
  });

  it("ignora otras subcategorías y pagos de deuda", () => {
    expect(
      getSubcategoryConsumptionCents(
        [
          expense(100, { subcategory: "Taxi" }),
          expense(200, { loanPaymentId: "payment", loanId: "loan" }),
        ],
        { category: "ocio", subcategory: "Comida" },
      ),
    ).toBe(0);
  });

  it("avisa al 80% y al alcanzar o superar el límite", () => {
    expect(getSubcategoryBudgetStatus(10_000, 7_900).level).toBe("ok");
    expect(getSubcategoryBudgetStatus(10_000, 7_900, 100).level).toBe("near");
    expect(getSubcategoryBudgetStatus(10_000, 9_000, 1_500)).toMatchObject({
      level: "exceeded",
      remainingCents: -500,
      percentage: 105,
    });
  });
});
