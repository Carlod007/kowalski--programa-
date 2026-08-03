import {
  collection,
  deleteField,
  doc,
  increment,
  runTransaction,
  serverTimestamp,
  type WithFieldValue,
} from "firebase/firestore";
import { db } from "@/lib/firebase";
import type { SavingsGoal, User } from "@/types/user";
import type {
  ExpenseTransaction,
  IncomeTransaction,
  Transaction,
} from "@/types/transaction";

export async function deleteTransaction(
  userId: string,
  monthId: string,
  txId: string,
): Promise<void> {
  const userRef = doc(db, "users", userId);
  const monthRef = doc(db, "users", userId, "months", monthId);
  const txRef = doc(
    db,
    "users",
    userId,
    "months",
    monthId,
    "transactions",
    txId,
  );

  await runTransaction(db, async (transaction) => {
    const [monthSnap, txSnap] = await Promise.all([
      transaction.get(monthRef),
      transaction.get(txRef),
    ]);

    if (!monthSnap.exists()) {
      throw new Error(`deleteTransaction: mes ${monthId} no existe`);
    }
    if (monthSnap.data().closed) {
      throw new Error("No se puede modificar un mes cerrado");
    }
    if (!txSnap.exists()) {
      throw new Error(`deleteTransaction: transacción ${txId} no existe`);
    }

    const tx = txSnap.data() as Transaction;

    if (tx.type === "expense") {
      const expense = tx as ExpenseTransaction;
      if (expense.category === "ahorro") {
        transaction.update(userRef, {
          savingsTotalCents: increment(expense.amountCents),
        });
      } else {
        transaction.update(monthRef, {
          [`spentCents.${expense.category}`]: increment(-expense.amountCents),
        });
      }
    } else {
      const income = tx as IncomeTransaction;
      transaction.update(monthRef, {
        totalIncomeCents: increment(-income.amountCents),
        incomeCount: increment(-1),
        "capsCents.necesidad": increment(-income.distribution.necesidad),
        "capsCents.ocio": increment(-income.distribution.ocio),
        ahorroContributedCents: increment(-income.distribution.ahorro),
      });
      transaction.update(userRef, {
        savingsTotalCents: increment(-income.distribution.ahorro),
      });
    }

    transaction.delete(txRef);
  });
}

export async function updateExpense(
  userId: string,
  monthId: string,
  txId: string,
  newValues: {
    amountCents: number;
    subcategory: string;
    paymentMethod: string;
    description?: string;
  },
): Promise<void> {
  const userRef = doc(db, "users", userId);
  const monthRef = doc(db, "users", userId, "months", monthId);
  const txRef = doc(
    db,
    "users",
    userId,
    "months",
    monthId,
    "transactions",
    txId,
  );

  await runTransaction(db, async (transaction) => {
    const [monthSnap, txSnap] = await Promise.all([
      transaction.get(monthRef),
      transaction.get(txRef),
    ]);

    if (!monthSnap.exists()) {
      throw new Error(`updateExpense: mes ${monthId} no existe`);
    }
    if (monthSnap.data().closed) {
      throw new Error("No se puede modificar un mes cerrado");
    }
    if (!txSnap.exists()) {
      throw new Error(`updateExpense: transacción ${txId} no existe`);
    }

    const tx = txSnap.data() as ExpenseTransaction;
    const delta = newValues.amountCents - tx.amountCents;

    if (tx.category === "ahorro") {
      transaction.update(userRef, {
        savingsTotalCents: increment(-delta),
      });
    } else {
      transaction.update(monthRef, {
        [`spentCents.${tx.category}`]: increment(delta),
      });
    }

    transaction.update(txRef, {
      amountCents: newValues.amountCents,
      subcategory: newValues.subcategory,
      paymentMethod: newValues.paymentMethod,
      description: newValues.description
        ? newValues.description
        : deleteField(),
    });
  });
}

export async function updateIncome(
  userId: string,
  monthId: string,
  txId: string,
  newValues: {
    amountCents: number;
    source: string;
    description?: string;
  },
): Promise<void> {
  const userRef = doc(db, "users", userId);
  const monthRef = doc(db, "users", userId, "months", monthId);
  const txRef = doc(
    db,
    "users",
    userId,
    "months",
    monthId,
    "transactions",
    txId,
  );

  await runTransaction(db, async (transaction) => {
    const [monthSnap, txSnap] = await Promise.all([
      transaction.get(monthRef),
      transaction.get(txRef),
    ]);

    if (!monthSnap.exists()) {
      throw new Error(`updateIncome: mes ${monthId} no existe`);
    }
    if (monthSnap.data().closed) {
      throw new Error("No se puede modificar un mes cerrado");
    }
    if (!txSnap.exists()) {
      throw new Error(`updateIncome: transacción ${txId} no existe`);
    }

    const tx = txSnap.data() as IncomeTransaction;

    if (tx.amountCents <= 0) {
      throw new Error(
        "Esta transacción no se puede editar por un problema en sus datos. Bórrala y regístrala de nuevo.",
      );
    }
    if (newValues.amountCents <= 0) {
      throw new Error("El monto debe ser mayor a 0");
    }

    const originalTotal = tx.amountCents;
    const necesidadShare =
      originalTotal > 0 ? tx.distribution.necesidad / originalTotal : 0;
    const ocioShare =
      originalTotal > 0 ? tx.distribution.ocio / originalTotal : 0;

    const newNecesidad = Math.floor(newValues.amountCents * necesidadShare);
    const newOcio = Math.floor(newValues.amountCents * ocioShare);
    const newAhorro = newValues.amountCents - newNecesidad - newOcio;

    const newSplit = {
      necesidad: newNecesidad,
      ocio: newOcio,
      ahorro: newAhorro,
    };

    transaction.update(monthRef, {
      totalIncomeCents: increment(newValues.amountCents - tx.amountCents),
      "capsCents.necesidad": increment(
        newSplit.necesidad - tx.distribution.necesidad,
      ),
      "capsCents.ocio": increment(newSplit.ocio - tx.distribution.ocio),
      ahorroContributedCents: increment(
        newSplit.ahorro - tx.distribution.ahorro,
      ),
    });
    transaction.update(userRef, {
      savingsTotalCents: increment(newSplit.ahorro - tx.distribution.ahorro),
    });

    transaction.update(txRef, {
      amountCents: newValues.amountCents,
      source: newValues.source,
      distribution: newSplit,
      description: newValues.description
        ? newValues.description
        : deleteField(),
    });
  });
}

/**
 * Compra de una Meta de Ahorro. Crea una transacción de tipo Egreso con
 * category "ahorro" (visible en Historial como cualquier otro gasto) y
 * descuenta el costo fijo de la meta del acumulado del usuario.
 */
export async function purchaseGoalExpense(
  userId: string,
  monthId: string,
  input: {
    goal: SavingsGoal;
    paymentMethod: string;
    description?: string;
    date: string;
  },
): Promise<void> {
  const userRef = doc(db, "users", userId);
  const monthRef = doc(db, "users", userId, "months", monthId);
  const txRef = doc(
    collection(db, "users", userId, "months", monthId, "transactions"),
  );

  await runTransaction(db, async (transaction) => {
    const [userSnap, monthSnap] = await Promise.all([
      transaction.get(userRef),
      transaction.get(monthRef),
    ]);

    if (!userSnap.exists()) {
      throw new Error(`purchaseGoalExpense: perfil ${userId} no existe`);
    }
    if (!monthSnap.exists()) {
      throw new Error(`purchaseGoalExpense: mes ${monthId} no existe`);
    }
    if (monthSnap.data().closed) {
      throw new Error("No se puede modificar un mes cerrado");
    }

    const userProfile = userSnap.data() as User;
    if ((userProfile.savingsTotalCents ?? 0) < input.goal.targetCents) {
      throw new Error("Fondos insuficientes para esta meta");
    }

    const tx: WithFieldValue<ExpenseTransaction> = {
      type: "expense",
      category: "ahorro",
      subcategory: input.goal.name,
      paymentMethod: input.paymentMethod,
      amountCents: input.goal.targetCents,
      transactionDate: input.date,
      serverDate: serverTimestamp(),
      localDate: new Date().toISOString(),
      ...(input.description ? { description: input.description } : {}),
    };
    transaction.set(txRef, tx);

    transaction.update(userRef, {
      savingsTotalCents: increment(-input.goal.targetCents),
    });
  });
}
