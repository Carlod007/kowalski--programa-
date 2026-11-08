import type {
  EssentialNeed,
  ExpenseTemplate,
  PaymentMethod,
  SubcategoryBudget,
  User,
} from "@/types/user";

export type SubcategoryKey = "necesidad" | "ocio";

export type SubcategoryRename = {
  category: SubcategoryKey;
  oldName: string;
  newName: string;
};

export type PaymentMethodRename = {
  oldName: string;
  newName: string;
};

export function normalizeCatalogName(name: string): string {
  return name.trim().toLocaleLowerCase("es");
}

export function isSameCatalogName(a: string, b: string): boolean {
  return normalizeCatalogName(a) === normalizeCatalogName(b);
}

export function hasDuplicateCatalogName(
  existingNames: string[],
  candidateName: string,
  excludeName?: string,
): boolean {
  const normalizedCandidate = normalizeCatalogName(candidateName);
  if (!normalizedCandidate) return false;
  const normalizedExclude =
    excludeName !== undefined ? normalizeCatalogName(excludeName) : null;

  let excludedOnce = false;
  for (const existing of existingNames) {
    const norm = normalizeCatalogName(existing);
    if (
      normalizedExclude !== null &&
      !excludedOnce &&
      norm === normalizedExclude
    ) {
      excludedOnce = true;
      continue;
    }
    if (norm === normalizedCandidate) {
      return true;
    }
  }
  return false;
}

export function findDuplicateCatalogName(names: string[]): string | null {
  const seen = new Set<string>();
  for (const raw of names) {
    const norm = normalizeCatalogName(raw);
    if (!norm) continue;
    if (seen.has(norm)) {
      return raw.trim();
    }
    seen.add(norm);
  }
  return null;
}

export function assertNoDuplicateCatalogNames(
  names: string[],
  catalogLabel: string,
): void {
  const dup = findDuplicateCatalogName(names);
  if (dup !== null) {
    throw new Error(`Ya existe "${dup}" en ${catalogLabel}`);
  }
}

/**
 * Propaga el cambio de nombre de una subcategoría a:
 * - subcategories[category]
 * - essentialNeeds (si category === "necesidad")
 * - subcategoryBudgets
 * - expenseTemplates
 */
export function propagateSubcategoryRename(
  state: {
    subcategories: Record<SubcategoryKey, string[]>;
    essentialNeeds?: EssentialNeed[];
    subcategoryBudgets?: SubcategoryBudget[];
    expenseTemplates?: ExpenseTemplate[];
  },
  category: SubcategoryKey,
  oldName: string,
  newName: string,
): {
  subcategories: Record<SubcategoryKey, string[]>;
  essentialNeeds: EssentialNeed[];
  subcategoryBudgets: SubcategoryBudget[];
  expenseTemplates: ExpenseTemplate[];
} {
  const trimmedNew = newName.trim();
  const normOld = normalizeCatalogName(oldName);

  const nextCategoryList = state.subcategories[category].map((item) =>
    normalizeCatalogName(item) === normOld ? trimmedNew : item,
  );
  const subcategories: Record<SubcategoryKey, string[]> = {
    ...state.subcategories,
    [category]: nextCategoryList,
  };

  const essentialNeeds = (state.essentialNeeds ?? []).map((need) =>
    category === "necesidad" && normalizeCatalogName(need.name) === normOld
      ? { ...need, name: trimmedNew }
      : need,
  );

  const subcategoryBudgets = (state.subcategoryBudgets ?? []).map((budget) =>
    budget.category === category &&
    normalizeCatalogName(budget.subcategory) === normOld
      ? { ...budget, subcategory: trimmedNew }
      : budget,
  );

  const expenseTemplates = (state.expenseTemplates ?? []).map((tpl) =>
    tpl.category === category &&
    normalizeCatalogName(tpl.subcategory) === normOld
      ? { ...tpl, subcategory: trimmedNew }
      : tpl,
  );

  return {
    subcategories,
    essentialNeeds,
    subcategoryBudgets,
    expenseTemplates,
  };
}

/**
 * Propaga el cambio de nombre de un método de pago a:
 * - paymentMethods
 * - expenseTemplates
 */
export function propagatePaymentMethodRename(
  state: Pick<User, "paymentMethods" | "expenseTemplates">,
  oldName: string,
  newName: string,
): {
  paymentMethods: PaymentMethod[];
  expenseTemplates: ExpenseTemplate[];
} {
  const trimmedNew = newName.trim();
  const normOld = normalizeCatalogName(oldName);

  const paymentMethods = state.paymentMethods.map((pm) =>
    normalizeCatalogName(pm.name) === normOld ? { ...pm, name: trimmedNew } : pm,
  );

  const expenseTemplates = (state.expenseTemplates ?? []).map((tpl) =>
    normalizeCatalogName(tpl.paymentMethod) === normOld
      ? { ...tpl, paymentMethod: trimmedNew }
      : tpl,
  );

  return {
    paymentMethods,
    expenseTemplates,
  };
}
