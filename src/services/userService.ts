import { doc, runTransaction, setDoc, updateDoc } from "firebase/firestore";
import { db } from "@/lib/firebase";
import {
  assertNoDuplicateCatalogNames,
  hasDuplicateCatalogName,
  isSameCatalogName,
  normalizeCatalogName,
  propagatePaymentMethodRename,
  propagateSubcategoryRename,
  type PaymentMethodRename,
  type SubcategoryKey,
  type SubcategoryRename,
} from "@/utils/masterTables";

export type { PaymentMethodRename, SubcategoryKey, SubcategoryRename };
import {
  DEFAULT_TIME_ZONE,
  isValidTimeZone,
  resolveTimeZone,
} from "@/utils/date";
import {
  DEFAULT_CLOSING_POLICY,
  getClosingPolicy,
} from "@/utils/closingPolicy";
import type {
  ClosingPolicy,
  EssentialNeed,
  ExpenseTemplate,
  FixedIncome,
  PaymentMethod,
  Source,
  SubcategoryBudget,
  User as UserProfile,
} from "@/types/user";

export function buildInitialUserProfile(
  data: Pick<UserProfile, "name" | "email">,
): UserProfile {
  return {
    name: data.name,
    email: data.email,
    sources: [],
    distribution: { necesidad: 50, ocio: 30, ahorro: 20 },
    subcategories: {
      necesidad: [],
      ocio: [],
    },
    paymentMethods: [],
    onboardingCompleted: false,
    lastClosedMonth: null,
    pendingCloseMonthId: null,
    unseenClosedMonthId: null,
    closingMode: "auto_grace",
    closingPolicy: DEFAULT_CLOSING_POLICY,
    timeZone: DEFAULT_TIME_ZONE,
    savingsTotalCents: 0,
    savingsGoals: [],
    fixedIncomes: [],
    essentialNeeds: [],
    expenseTemplates: [],
    subcategoryBudgets: [],
  };
}

export async function createUserProfile(
  userId: string,
  data: Pick<UserProfile, "name" | "email">,
): Promise<UserProfile> {
  const ref = doc(db, "users", userId);
  const profile = buildInitialUserProfile(data);
  await setDoc(ref, profile);
  return profile;
}

export async function updateUserProfile(
  userId: string,
  data: Partial<UserProfile>,
): Promise<void> {
  const ref = doc(db, "users", userId);
  await updateDoc(ref, data);
}

function inferPositionalSubcategoryRenames(
  before: Record<SubcategoryKey, string[]>,
  after: Record<SubcategoryKey, string[]>,
): SubcategoryRename[] {
  const inferred: SubcategoryRename[] = [];
  for (const category of ["necesidad", "ocio"] as const) {
    const oldList = before[category] ?? [];
    const newList = after[category] ?? [];
    if (oldList.length === newList.length) {
      const oldNormSet = new Set(oldList.map(normalizeCatalogName));
      const newNormSet = new Set(newList.map(normalizeCatalogName));
      for (let i = 0; i < oldList.length; i++) {
        const oldItem = oldList[i];
        const newItem = newList[i];
        if (
          oldItem !== newItem &&
          !newNormSet.has(normalizeCatalogName(oldItem)) &&
          !oldNormSet.has(normalizeCatalogName(newItem))
        ) {
          inferred.push({ category, oldName: oldItem, newName: newItem.trim() });
        }
      }
    }
  }
  return inferred;
}

/**
 * Guarda el catálogo de subcategorías y necesidades esenciales, bloqueando
 * duplicados y propagando en la misma operación atómica cualquier renombrado
 * a essentialNeeds, subcategoryBudgets y expenseTemplates.
 */
export async function saveSubcategoriesCatalog(
  userId: string,
  input: {
    subcategories: Record<SubcategoryKey, string[]>;
    essentialNeeds: EssentialNeed[];
    renames?: SubcategoryRename[];
  },
): Promise<{
  subcategories: Record<SubcategoryKey, string[]>;
  essentialNeeds: EssentialNeed[];
  subcategoryBudgets: SubcategoryBudget[];
  expenseTemplates: ExpenseTemplate[];
}> {
  const cleanedSubcategories: Record<SubcategoryKey, string[]> = {
    necesidad: input.subcategories.necesidad.map((s) => s.trim()).filter(Boolean),
    ocio: input.subcategories.ocio.map((s) => s.trim()).filter(Boolean),
  };

  assertNoDuplicateCatalogNames(
    cleanedSubcategories.necesidad,
    "Subcategorías de Necesidad",
  );
  assertNoDuplicateCatalogNames(
    cleanedSubcategories.ocio,
    "Subcategorías de Ocio",
  );

  const userRef = doc(db, "users", userId);

  return runTransaction(db, async (transaction) => {
    const userSnap = await transaction.get(userRef);
    if (!userSnap.exists()) {
      throw new Error(`saveSubcategoriesCatalog: perfil ${userId} no existe`);
    }
    const currentProfile = userSnap.data() as UserProfile;

    const renamesToApply =
      input.renames && input.renames.length > 0
        ? input.renames
        : inferPositionalSubcategoryRenames(
            currentProfile.subcategories ?? { necesidad: [], ocio: [] },
            cleanedSubcategories,
          );

    let essentialNeeds = input.essentialNeeds.map((n) => ({
      ...n,
      name: n.name.trim(),
    }));
    let subcategoryBudgets = [...(currentProfile.subcategoryBudgets ?? [])];
    let expenseTemplates = [...(currentProfile.expenseTemplates ?? [])];

    for (const rename of renamesToApply) {
      if (rename.oldName.trim() === rename.newName.trim()) continue;
      const propagated = propagateSubcategoryRename(
        {
          subcategories: cleanedSubcategories,
          essentialNeeds,
          subcategoryBudgets,
          expenseTemplates,
        },
        rename.category,
        rename.oldName,
        rename.newName,
      );
      essentialNeeds = propagated.essentialNeeds;
      subcategoryBudgets = propagated.subcategoryBudgets;
      expenseTemplates = propagated.expenseTemplates;
    }

    transaction.update(userRef, {
      subcategories: cleanedSubcategories,
      essentialNeeds,
      subcategoryBudgets,
      expenseTemplates,
    });

    return {
      subcategories: cleanedSubcategories,
      essentialNeeds,
      subcategoryBudgets,
      expenseTemplates,
    };
  });
}

/**
 * Renombra una subcategoría de forma atómica y propaga el nuevo nombre a
 * essentialNeeds, subcategoryBudgets y expenseTemplates del perfil.
 */
export async function renameSubcategory(
  userId: string,
  category: SubcategoryKey,
  oldName: string,
  newName: string,
): Promise<{
  subcategories: Record<SubcategoryKey, string[]>;
  essentialNeeds: EssentialNeed[];
  subcategoryBudgets: SubcategoryBudget[];
  expenseTemplates: ExpenseTemplate[];
}> {
  const trimmedNew = newName.trim();
  if (!trimmedNew) {
    throw new Error("El nombre de la subcategoría no puede estar vacío");
  }

  const userRef = doc(db, "users", userId);

  return runTransaction(db, async (transaction) => {
    const userSnap = await transaction.get(userRef);
    if (!userSnap.exists()) {
      throw new Error(`renameSubcategory: perfil ${userId} no existe`);
    }
    const profile = userSnap.data() as UserProfile;
    const currentList = profile.subcategories?.[category] ?? [];

    if (hasDuplicateCatalogName(currentList, trimmedNew, oldName)) {
      throw new Error(
        `Ya existe una subcategoría "${trimmedNew}" en ${category === "necesidad" ? "Necesidad" : "Ocio"}`,
      );
    }

    const propagated = propagateSubcategoryRename(
      {
        subcategories: profile.subcategories ?? { necesidad: [], ocio: [] },
        essentialNeeds: profile.essentialNeeds ?? [],
        subcategoryBudgets: profile.subcategoryBudgets ?? [],
        expenseTemplates: profile.expenseTemplates ?? [],
      },
      category,
      oldName,
      trimmedNew,
    );

    transaction.update(userRef, propagated);
    return propagated;
  });
}

/**
 * Guarda el catálogo de métodos de pago bloqueando duplicados y propagando en
 * la misma operación atómica cualquier renombrado (detectado por id o explícito)
 * a expenseTemplates del perfil.
 */
export async function savePaymentMethodsCatalog(
  userId: string,
  input: {
    paymentMethods: PaymentMethod[];
    renames?: PaymentMethodRename[];
  },
): Promise<{
  paymentMethods: PaymentMethod[];
  expenseTemplates: ExpenseTemplate[];
}> {
  const cleanedMethods = input.paymentMethods
    .map((m) => ({ ...m, name: m.name.trim() }))
    .filter((m) => m.name !== "");

  assertNoDuplicateCatalogNames(
    cleanedMethods.map((m) => m.name),
    "Métodos de pago",
  );

  const userRef = doc(db, "users", userId);

  return runTransaction(db, async (transaction) => {
    const userSnap = await transaction.get(userRef);
    if (!userSnap.exists()) {
      throw new Error(`savePaymentMethodsCatalog: perfil ${userId} no existe`);
    }
    const currentProfile = userSnap.data() as UserProfile;
    const currentById = new Map(
      (currentProfile.paymentMethods ?? []).map((pm) => [pm.id, pm]),
    );

    const detectedRenames: PaymentMethodRename[] = [...(input.renames ?? [])];
    for (const nextPm of cleanedMethods) {
      const prevPm = currentById.get(nextPm.id);
      if (prevPm && prevPm.name.trim() !== nextPm.name.trim()) {
        detectedRenames.push({
          oldName: prevPm.name,
          newName: nextPm.name,
        });
      }
    }

    let expenseTemplates = [...(currentProfile.expenseTemplates ?? [])];
    for (const rename of detectedRenames) {
      const propagated = propagatePaymentMethodRename(
        { paymentMethods: cleanedMethods, expenseTemplates },
        rename.oldName,
        rename.newName,
      );
      expenseTemplates = propagated.expenseTemplates;
    }

    transaction.update(userRef, {
      paymentMethods: cleanedMethods,
      expenseTemplates,
    });

    return {
      paymentMethods: cleanedMethods,
      expenseTemplates,
    };
  });
}

/**
 * Renombra un método de pago de forma atómica y propaga el nuevo nombre a
 * expenseTemplates del perfil.
 */
export async function renamePaymentMethod(
  userId: string,
  oldName: string,
  newName: string,
): Promise<{
  paymentMethods: PaymentMethod[];
  expenseTemplates: ExpenseTemplate[];
}> {
  const trimmedNew = newName.trim();
  if (!trimmedNew) {
    throw new Error("El nombre del método de pago no puede estar vacío");
  }

  const userRef = doc(db, "users", userId);

  return runTransaction(db, async (transaction) => {
    const userSnap = await transaction.get(userRef);
    if (!userSnap.exists()) {
      throw new Error(`renamePaymentMethod: perfil ${userId} no existe`);
    }
    const profile = userSnap.data() as UserProfile;
    const currentNames = (profile.paymentMethods ?? []).map((m) => m.name);

    if (hasDuplicateCatalogName(currentNames, trimmedNew, oldName)) {
      throw new Error(`Ya existe un método de pago "${trimmedNew}"`);
    }

    const propagated = propagatePaymentMethodRename(
      {
        paymentMethods: profile.paymentMethods ?? [],
        expenseTemplates: profile.expenseTemplates ?? [],
      },
      oldName,
      trimmedNew,
    );

    transaction.update(userRef, propagated);
    return propagated;
  });
}

/**
 * Guarda el catálogo de fuentes de ingreso e ingresos fijos bloqueando
 * duplicados normalizados.
 */
export async function saveIncomeSourcesCatalog(
  userId: string,
  input: {
    sources: Source[];
    fixedIncomes: FixedIncome[];
  },
): Promise<{
  sources: Source[];
  fixedIncomes: FixedIncome[];
}> {
  const cleanedSources = input.sources
    .map((s) => ({ ...s, name: s.name.trim() }))
    .filter((s) => s.name !== "");

  assertNoDuplicateCatalogNames(
    cleanedSources.map((s) => s.name),
    "Fuentes de ingreso",
  );

  const cleanedFixedIncomes = input.fixedIncomes.map((f) => {
    const matchingSource = cleanedSources.find(
      (s) => s.id === f.id || isSameCatalogName(s.name, f.name),
    );
    return {
      ...f,
      name: matchingSource ? matchingSource.name : f.name.trim(),
    };
  });

  const userRef = doc(db, "users", userId);
  await updateDoc(userRef, {
    sources: cleanedSources,
    fixedIncomes: cleanedFixedIncomes,
  });

  return {
    sources: cleanedSources,
    fixedIncomes: cleanedFixedIncomes,
  };
}

export async function updateClosingPolicy(
  userId: string,
  policy: ClosingPolicy,
): Promise<ClosingPolicy> {
  const resolved = getClosingPolicy(policy);
  const userRef = doc(db, "users", userId);
  const payload: ClosingPolicy = {
    necesidadSurplus: resolved.necesidadSurplus,
    ocioSurplus: resolved.ocioSurplus,
    ...(resolved.necesidadSurplus === "rollover_capped"
      ? { necesidadRolloverCapCents: resolved.necesidadRolloverCapCents }
      : {}),
  };
  await updateDoc(userRef, {
    closingPolicy: payload,
  });
  return payload;
}

export async function updateUserTimeZone(
  userId: string,
  timeZone: string,
): Promise<string> {
  if (!isValidTimeZone(timeZone)) {
    throw new Error(`Zona horaria inválida: ${timeZone}`);
  }
  const resolved = resolveTimeZone(timeZone);
  const userRef = doc(db, "users", userId);
  await updateDoc(userRef, {
    timeZone: resolved,
  });
  return resolved;
}
