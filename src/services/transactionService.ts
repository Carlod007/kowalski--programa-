import { deleteField, doc, increment, runTransaction } from "firebase/firestore";
import { db } from "@/lib/firebase";
import { calculateDistribution } from "@/utils/distribution";
import type { Month } from "@/types/month";
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
  const monthRef = doc(db, "users", userId, "months", monthId);
  const txRef = doc(db, "users", userId, "months", monthId, "transactions", txId);

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
      transaction.update(monthRef, {
        [`spentCents.${expense.category}`]: increment(-expense.amountCents),
      });
    } else {
      const income = tx as IncomeTransaction;
      transaction.update(monthRef, {
        totalIncomeCents: increment(-income.amountCents),
        incomeCount: increment(-1),
        "capsCents.necesidad": increment(-income.distribution.necesidad),
        "capsCents.ocio": increment(-income.distribution.ocio),
        "capsCents.ahorro": increment(-income.distribution.ahorro),
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
  const monthRef = doc(db, "users", userId, "months", monthId);
  const txRef = doc(db, "users", userId, "months", monthId, "transactions", txId);

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

    transaction.update(monthRef, {
      [`spentCents.${tx.category}`]: increment(delta),
    });

    transaction.update(txRef, {
      amountCents: newValues.amountCents,
      subcategory: newValues.subcategory,
      paymentMethod: newValues.paymentMethod,
      description: newValues.description ? newValues.description : deleteField(),
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
  const monthRef = doc(db, "users", userId, "months", monthId);
  const txRef = doc(db, "users", userId, "months", monthId, "transactions", txId);

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
    const month = monthSnap.data() as Month;
    const newSplit = calculateDistribution(newValues.amountCents, month.distribution);

    transaction.update(monthRef, {
      totalIncomeCents: increment(newValues.amountCents - tx.amountCents),
      "capsCents.necesidad": increment(newSplit.necesidad - tx.distribution.necesidad),
      "capsCents.ocio": increment(newSplit.ocio - tx.distribution.ocio),
      "capsCents.ahorro": increment(newSplit.ahorro - tx.distribution.ahorro),
    });

    transaction.update(txRef, {
      amountCents: newValues.amountCents,
      source: newValues.source,
      distribution: newSplit,
      description: newValues.description ? newValues.description : deleteField(),
    });
  });
}
