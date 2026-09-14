import { doc, runTransaction } from "firebase/firestore";
import { db } from "@/lib/firebase";
import type { SubcategoryBudget, User as UserProfile } from "@/types/user";

export async function saveSubcategoryBudgets(
  userId: string,
  budgets: SubcategoryBudget[],
): Promise<void> {
  const userRef = doc(db, "users", userId);
  await runTransaction(db, async (transaction) => {
    const snapshot = await transaction.get(userRef);
    if (!snapshot.exists()) throw new Error("No se encontró el perfil");
    const profile = snapshot.data() as UserProfile;
    const seen = new Set<string>();
    const cleanBudgets = budgets.map((budget) => {
      if (
        !Number.isInteger(budget.monthlyLimitCents) ||
        budget.monthlyLimitCents <= 0
      ) {
        throw new Error("Cada límite debe ser mayor a cero");
      }
      if (!profile.subcategories[budget.category]?.includes(budget.subcategory)) {
        throw new Error(`La subcategoría ${budget.subcategory} ya no existe`);
      }
      const key = `${budget.category}\u0000${budget.subcategory}`;
      if (seen.has(key)) throw new Error("Hay límites duplicados");
      seen.add(key);
      return {
        category: budget.category,
        subcategory: budget.subcategory,
        monthlyLimitCents: budget.monthlyLimitCents,
      };
    });
    transaction.update(userRef, { subcategoryBudgets: cleanBudgets });
  });
}
