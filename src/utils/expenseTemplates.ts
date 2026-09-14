import type { ExpenseTemplate, PaymentMethod } from "@/types/user";

export const MAX_EXPENSE_TEMPLATES = 30;

export function getExpenseTemplateLabel(template: ExpenseTemplate): string {
  return template.description?.trim() || template.subcategory;
}

export function isExpenseTemplateUsable(
  template: ExpenseTemplate,
  subcategories: Record<"necesidad" | "ocio", string[]>,
  paymentMethods: PaymentMethod[],
): boolean {
  return (
    subcategories[template.category]?.includes(template.subcategory) &&
    paymentMethods.some((method) => method.name === template.paymentMethod)
  );
}

export function sanitizeExpenseTemplate(
  template: ExpenseTemplate,
): ExpenseTemplate {
  const description = template.description?.trim();
  return {
    id: template.id,
    category: template.category,
    subcategory: template.subcategory.trim(),
    paymentMethod: template.paymentMethod.trim(),
    ...(template.amountCents && template.amountCents > 0
      ? { amountCents: Math.round(template.amountCents) }
      : {}),
    ...(description ? { description } : {}),
  };
}
