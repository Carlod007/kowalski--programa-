export const MAX_EXPENSE_TAGS = 5;
export const MAX_EXPENSE_TAG_LENGTH = 24;

export function normalizeExpenseTags(value: string | readonly string[]): string[] {
  const rawTags = typeof value === "string" ? value.split(",") : value;
  const unique = new Map<string, string>();
  for (const rawTag of rawTags) {
    const clean = rawTag.trim().replace(/^#+/, "").replace(/\s+/g, " ");
    if (!clean) continue;
    const clipped = clean.slice(0, MAX_EXPENSE_TAG_LENGTH);
    const key = clipped.toLocaleLowerCase("es");
    if (!unique.has(key)) unique.set(key, clipped);
    if (unique.size === MAX_EXPENSE_TAGS) break;
  }
  return [...unique.values()];
}

export function hasExpenseTag(
  tags: readonly string[] | undefined,
  selectedTag: string | null,
): boolean {
  if (!selectedTag) return true;
  const key = selectedTag.toLocaleLowerCase("es");
  return (tags ?? []).some((tag) => tag.toLocaleLowerCase("es") === key);
}

export function getAvailableExpenseTags(
  expenses: readonly { tags?: readonly string[] }[],
): string[] {
  const unique = new Map<string, string>();
  for (const expense of expenses) {
    for (const tag of expense.tags ?? []) {
      const clean = tag.trim();
      if (!clean) continue;
      const key = clean.toLocaleLowerCase("es");
      if (!unique.has(key)) unique.set(key, clean);
    }
  }
  return [...unique.values()].sort((left, right) =>
    left.localeCompare(right, "es", { sensitivity: "base" }),
  );
}
