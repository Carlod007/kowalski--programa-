import { describe, expect, it } from "vitest";
import type { CreditCardPayment } from "@/types/creditCard";
import type { ExpenseTransaction } from "@/types/transaction";
import {
  classifyOutflow,
  getConsumptionByCategory,
  getConsumptionTotalCents,
  isConsumptionExpense,
  summarizeOutflows,
} from "./expenseClassification";

function expense(
  overrides: Partial<ExpenseTransaction> = {},
): ExpenseTransaction {
  return {
    type: "expense",
    category: "necesidad",
    subcategory: "Prueba",
    paymentMethod: "Yape",
    amountCents: 1_000,
    localDate: "2026-09-13",
    transactionDate: "2026-09-13",
    serverDate: null,
    ...overrides,
  };
}

function cardPayment(amountCents = 1_000): CreditCardPayment {
  return {
    userId: "user",
    cardId: "card",
    cardName: "Banco · Visa",
    mode: "other",
    amountCents,
    statementAppliedCents: amountCents,
    paymentDate: "2026-09-13",
    serverDate: null,
  };
}

describe("classifyOutflow", () => {
  it("clasifica un gasto antiguo sin marcas como consumo propio", () => {
    expect(classifyOutflow(expense())).toBe("owned-consumption");
  });

  it("clasifica consumo con préstamo, tarjeta e intereses por separado", () => {
    expect(classifyOutflow(expense({ fundedByLoanId: "loan" }))).toBe(
      "loan-consumption",
    );
    expect(classifyOutflow(expense({ creditCardId: "card" }))).toBe(
      "card-consumption",
    );
    expect(
      classifyOutflow(
        expense({
          creditCardId: "card",
          creditCardChargeKind: "interest-fees",
        }),
      ),
    ).toBe("card-interest");
  });

  it("da prioridad al pago de préstamo y reconoce pagos de tarjeta", () => {
    expect(
      classifyOutflow(
        expense({
          loanPaymentId: "payment",
          loanId: "loan",
          fundedByLoanId: "legacy-conflict",
        }),
      ),
    ).toBe("debt-payment");
    expect(classifyOutflow(cardPayment())).toBe("debt-payment");
  });

  it("cuenta cada salida una sola vez y excluye deuda del consumo", () => {
    const own = expense({ amountCents: 100 });
    const loan = expense({ amountCents: 200, fundedByLoanId: "loan" });
    const card = expense({ amountCents: 300, creditCardId: "card" });
    const interest = expense({
      amountCents: 40,
      creditCardId: "card",
      creditCardChargeKind: "interest-fees",
    });
    const loanPayment = expense({
      amountCents: 500,
      category: "ahorro",
      loanPaymentId: "payment",
      loanId: "loan",
    });
    const totals = summarizeOutflows([
      own,
      loan,
      card,
      interest,
      loanPayment,
      cardPayment(600),
    ]);

    expect(totals).toEqual({
      "owned-consumption": 100,
      "loan-consumption": 200,
      "card-consumption": 300,
      "card-interest": 40,
      "debt-payment": 1_100,
    });
    expect(getConsumptionTotalCents(totals)).toBe(640);
    expect(isConsumptionExpense(loanPayment)).toBe(false);
  });

  it("mantiene por categoría solo el consumo", () => {
    expect(
      getConsumptionByCategory([
        expense({ amountCents: 100, category: "necesidad" }),
        expense({ amountCents: 200, category: "ocio", creditCardId: "card" }),
        expense({
          amountCents: 300,
          category: "ahorro",
          loanPaymentId: "payment",
        }),
      ]),
    ).toEqual({ necesidad: 100, ocio: 200, ahorro: 0 });
  });
});
