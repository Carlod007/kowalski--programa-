import { describe, expect, it } from "vitest";
import {
  getExpenseTemplateLabel,
  isExpenseTemplateUsable,
  sanitizeExpenseTemplate,
} from "./expenseTemplates";
import type { ExpenseTemplate } from "@/types/user";

const template: ExpenseTemplate = {
  id: "template-1",
  category: "ocio",
  subcategory: "Comida",
  amountCents: 1_500,
  description: "  Menú diario  ",
  paymentMethod: "Yape",
};

describe("plantillas de egresos", () => {
  it("limpia los campos opcionales sin agregar fuentes de deuda", () => {
    expect(sanitizeExpenseTemplate(template)).toEqual({
      ...template,
      description: "Menú diario",
    });
  });

  it("usa la descripción como nombre y la subcategoría como respaldo", () => {
    expect(getExpenseTemplateLabel(template)).toBe("Menú diario");
    expect(getExpenseTemplateLabel({ ...template, description: " " })).toBe(
      "Comida",
    );
  });

  it("detecta configuraciones antiguas antes de rellenar el formulario", () => {
    const subcategories = { necesidad: ["Salud"], ocio: ["Comida"] };
    const paymentMethods = [{ id: "yape", name: "Yape", type: "digital" as const }];
    expect(isExpenseTemplateUsable(template, subcategories, paymentMethods)).toBe(true);
    expect(
      isExpenseTemplateUsable(
        { ...template, paymentMethod: "Efectivo" },
        subcategories,
        paymentMethods,
      ),
    ).toBe(false);
  });
});
