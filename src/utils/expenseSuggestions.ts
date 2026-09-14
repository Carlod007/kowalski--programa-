import type { ExpenseTransaction } from "@/types/transaction";
import type { ExpenseTemplate } from "@/types/user";
import { isConsumptionExpense } from "@/utils/expenseClassification";

export type ExpenseSuggestion = {
  category: "necesidad" | "ocio";
  subcategory: string;
  reason: "template" | "history";
  confidence: "exact" | "similar";
};

export function normalizeExpenseText(value: string): string {
  return value
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim()
    .replace(/\s+/g, " ");
}

function similarity(left: string, right: string): number {
  if (!left || !right) return 0;
  if (left === right) return 1;
  if (left.length >= 4 && right.length >= 4) {
    if (left.includes(right) || right.includes(left)) return 0.85;
  }
  const leftTokens = new Set(left.split(" ").filter((token) => token.length > 2));
  const rightTokens = new Set(
    right.split(" ").filter((token) => token.length > 2),
  );
  if (leftTokens.size === 0 || rightTokens.size === 0) return 0;
  const shared = [...leftTokens].filter((token) => rightTokens.has(token)).length;
  return shared / Math.max(leftTokens.size, rightTokens.size);
}

export function suggestExpenseClassification(
  description: string,
  templates: readonly ExpenseTemplate[],
  expenses: readonly ExpenseTransaction[],
): ExpenseSuggestion | null {
  const query = normalizeExpenseText(description);
  if (query.length < 3) return null;

  type Candidate = ExpenseSuggestion & { score: number };
  const candidates: Candidate[] = [];

  for (const template of templates) {
    const texts = [template.description ?? "", template.subcategory]
      .map(normalizeExpenseText)
      .filter(Boolean);
    const best = Math.max(0, ...texts.map((text) => similarity(query, text)));
    if (best < 0.6) continue;
    candidates.push({
      category: template.category,
      subcategory: template.subcategory,
      reason: "template",
      confidence: best === 1 ? "exact" : "similar",
      score: best * 1_000 + 100,
    });
  }

  for (const expense of expenses) {
    if (
      !isConsumptionExpense(expense) ||
      expense.category === "ahorro" ||
      expense.creditCardChargeKind === "interest-fees"
    ) {
      continue;
    }
    const best = Math.max(
      similarity(query, normalizeExpenseText(expense.description ?? "")),
      similarity(query, normalizeExpenseText(expense.subcategory)),
    );
    if (best < 0.6) continue;
    candidates.push({
      category: expense.category,
      subcategory: expense.subcategory,
      reason: "history",
      confidence: best === 1 ? "exact" : "similar",
      score: best * 1_000,
    });
  }

  if (candidates.length === 0) return null;
  const grouped = new Map<string, Candidate>();
  for (const candidate of candidates) {
    const key = `${candidate.category}\u0000${candidate.subcategory}`;
    const current = grouped.get(key);
    if (!current) grouped.set(key, candidate);
    else {
      current.score += candidate.score * 0.15;
      if (candidate.reason === "template") current.reason = "template";
      if (candidate.confidence === "exact") current.confidence = "exact";
    }
  }
  const winner = [...grouped.values()].sort((a, b) => b.score - a.score)[0];
  return {
    category: winner.category,
    subcategory: winner.subcategory,
    reason: winner.reason,
    confidence: winner.confidence,
  };
}
