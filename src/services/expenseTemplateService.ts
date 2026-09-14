import { doc, runTransaction } from "firebase/firestore";
import { db } from "@/lib/firebase";
import type { ExpenseTemplate, User as UserProfile } from "@/types/user";
import {
  MAX_EXPENSE_TEMPLATES,
  sanitizeExpenseTemplate,
} from "@/utils/expenseTemplates";

function validateTemplate(template: ExpenseTemplate): void {
  if (!template.id || !template.subcategory.trim() || !template.paymentMethod.trim()) {
    throw new Error("Completa la subcategoría y el método de pago");
  }
  if (template.subcategory.trim().length > 100) {
    throw new Error("La subcategoría es demasiado larga");
  }
  if ((template.description?.trim().length ?? 0) > 200) {
    throw new Error("La descripción es demasiado larga");
  }
  if (
    template.amountCents !== undefined &&
    (!Number.isInteger(template.amountCents) || template.amountCents <= 0)
  ) {
    throw new Error("El monto debe ser mayor a cero");
  }
}

export async function saveExpenseTemplate(
  userId: string,
  template: ExpenseTemplate,
): Promise<void> {
  validateTemplate(template);
  const cleanTemplate = sanitizeExpenseTemplate(template);
  const userRef = doc(db, "users", userId);

  await runTransaction(db, async (transaction) => {
    const snapshot = await transaction.get(userRef);
    if (!snapshot.exists()) throw new Error("No se encontró el perfil");
    const profile = snapshot.data() as UserProfile;
    if (
      !profile.subcategories[cleanTemplate.category]?.includes(
        cleanTemplate.subcategory,
      ) ||
      !profile.paymentMethods.some(
        (method) => method.name === cleanTemplate.paymentMethod,
      )
    ) {
      throw new Error(
        "La subcategoría o el método de pago ya no está disponible",
      );
    }
    const current = profile.expenseTemplates ?? [];
    const existingIndex = current.findIndex((item) => item.id === cleanTemplate.id);
    const next = [...current];
    if (existingIndex >= 0) next[existingIndex] = cleanTemplate;
    else {
      if (current.length >= MAX_EXPENSE_TEMPLATES) {
        throw new Error(`Puedes guardar hasta ${MAX_EXPENSE_TEMPLATES} gastos frecuentes`);
      }
      next.push(cleanTemplate);
    }
    transaction.update(userRef, { expenseTemplates: next });
  });
}

export async function deleteExpenseTemplate(
  userId: string,
  templateId: string,
): Promise<void> {
  const userRef = doc(db, "users", userId);
  await runTransaction(db, async (transaction) => {
    const snapshot = await transaction.get(userRef);
    if (!snapshot.exists()) throw new Error("No se encontró el perfil");
    const profile = snapshot.data() as UserProfile;
    transaction.update(userRef, {
      expenseTemplates: (profile.expenseTemplates ?? []).filter(
        (item) => item.id !== templateId,
      ),
    });
  });
}
