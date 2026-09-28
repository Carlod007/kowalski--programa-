import { describe, expect, it } from "vitest";
import type { ExpenseTransaction } from "@/types/transaction";
import {
  getSubcategoryBudgetStatus,
  getSubcategoryConsumptionCents,
  getSubcategoryObjectiveCopy,
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

describe("objetivo mensual por subcategoría", () => {
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

  it("avisa al 80% y al alcanzar o superar el objetivo", () => {
    expect(getSubcategoryBudgetStatus(10_000, 7_900).level).toBe("ok");
    expect(getSubcategoryBudgetStatus(10_000, 7_900, 100).level).toBe("near");
    expect(getSubcategoryBudgetStatus(10_000, 9_000, 1_500)).toMatchObject({
      level: "exceeded",
      remainingCents: -500,
      percentage: 105,
    });
  });

  it("distingue objetivo superado, alcanzado y cercano sin monto nuevo", () => {
    const over = getSubcategoryObjectiveCopy("Ocio QA", 20_000, getSubcategoryBudgetStatus(20_000, 20_800), false);
    expect(over.primary).toMatch(/Objetivo mensual de Ocio QA: S\/\s*208\.00 de S\/\s*200\.00\. Superado por S\/\s*8\.00\./);
    expect(over.showClarification).toBe(true);

    const exact = getSubcategoryObjectiveCopy("Ocio QA", 20_000, getSubcategoryBudgetStatus(20_000, 20_000), false);
    expect(exact.primary).toMatch(/Alcanzaste el objetivo mensual de Ocio QA: S\/\s*200\.00 de S\/\s*200\.00\./);
    expect(exact.showClarification).toBe(false);

    const near = getSubcategoryObjectiveCopy("Ocio QA", 20_000, getSubcategoryBudgetStatus(20_000, 18_000), false);
    expect(near.primary).toMatch(/Faltan S\/\s*20\.00 para el objetivo mensual de Ocio QA\./);
    expect(near.showClarification).toBe(true);
  });

  it("muestra el consumo proyectado cuando se escribe un monto", () => {
    const near = getSubcategoryObjectiveCopy("Ocio QA", 20_000, getSubcategoryBudgetStatus(20_000, 16_000, 1_000), true);
    expect(near.primary).toMatch(/Con este gasto: S\/\s*170\.00 de S\/\s*200\.00 en Ocio QA\. Faltan S\/\s*30\.00/);
    expect(near.showClarification).toBe(true);

    const over = getSubcategoryObjectiveCopy("Ocio QA", 20_000, getSubcategoryBudgetStatus(20_000, 20_800, 2_000), true);
    expect(over.primary).toMatch(/Con este gasto: S\/\s*228\.00 de S\/\s*200\.00 en Ocio QA\. Superado por S\/\s*28\.00\./);
    expect(over.showClarification).toBe(true);

    const below = getSubcategoryObjectiveCopy("Ocio QA", 20_000, getSubcategoryBudgetStatus(20_000, 5_000, 1_000), true);
    expect(below.primary).toMatch(/Con este gasto: S\/\s*60\.00 de S\/\s*200\.00 en Ocio QA\./);
    expect(below.showClarification).toBe(false);
  });
});
