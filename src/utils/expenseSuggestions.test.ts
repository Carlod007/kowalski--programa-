import { describe, expect, it } from "vitest";
import type { ExpenseTransaction } from "@/types/transaction";
import type { ExpenseTemplate } from "@/types/user";
import {
  normalizeExpenseText,
  suggestExpenseClassification,
} from "./expenseSuggestions";

const template: ExpenseTemplate = {
  id: "lunch",
  category: "ocio",
  subcategory: "Comida",
  description: "Almuerzo oficina",
  paymentMethod: "Yape",
};

function expense(
  description: string,
  overrides: Partial<ExpenseTransaction> = {},
): ExpenseTransaction {
  return {
    type: "expense",
    category: "necesidad",
    subcategory: "Salud",
    description,
    paymentMethod: "Yape",
    amountCents: 1_000,
    transactionDate: "2026-09-13",
    localDate: "2026-09-13",
    serverDate: null,
    ...overrides,
  };
}

describe("sugerencias de egresos", () => {
  it("normaliza mayúsculas, tildes y signos", () => {
    expect(normalizeExpenseText("  MÉDICO / control  ")).toBe("medico control");
  });

  it("prioriza una plantilla coincidente", () => {
    expect(suggestExpenseClassification("almuerzo oficina", [template], [])).toEqual({
      category: "ocio",
      subcategory: "Comida",
      reason: "template",
      confidence: "exact",
    });
  });

  it("aprende de gastos anteriores similares", () => {
    expect(
      suggestExpenseClassification("control medico", [], [
        expense("Control médico mensual"),
        expense("Control médico"),
      ]),
    ).toMatchObject({
      category: "necesidad",
      subcategory: "Salud",
      reason: "history",
    });
  });

  it("ignora pagos de deuda y no adivina con texto insuficiente", () => {
    expect(
      suggestExpenseClassification("cuota", [], [
        expense("Cuota", { loanPaymentId: "payment", loanId: "loan" }),
      ]),
    ).toBeNull();
    expect(suggestExpenseClassification("a", [template], [])).toBeNull();
  });
});
