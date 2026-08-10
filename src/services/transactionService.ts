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
import { calculateProportionalSplit } from "@/utils/distribution";
import {
  getGoalAllocated,
  getGoalKind,
  getPurchaseCount,
  getUnassignedCents,
} from "@/utils/savings";
import type { User } from "@/types/user";
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

    // Si el egreso era la compra de una meta, hay que deshacer el contador de
    // compras además de devolver la plata. Se lee el perfil ANTES de escribir
    // nada, porque una transacción de Firestore no admite lecturas después de
    // la primera escritura.
    const purchasedGoalId =
      tx.type === "expense" &&
      (tx as ExpenseTransaction).category === "ahorro" &&
      (tx as ExpenseTransaction).goalId
        ? (tx as ExpenseTransaction).goalId
        : null;
    const userSnap = purchasedGoalId
      ? await transaction.get(userRef)
      : null;

    if (tx.type === "expense") {
      const expense = tx as ExpenseTransaction;
      if (expense.category === "ahorro") {
        const userUpdate: Record<string, unknown> = {
          savingsTotalCents: increment(expense.amountCents),
        };

        if (purchasedGoalId && userSnap?.exists()) {
          const goals = (userSnap.data() as User).savingsGoals ?? [];
          userUpdate.savingsGoals = goals.map((g) => {
            if (g.id !== purchasedGoalId) return g;
            const nextCount = Math.max(0, getPurchaseCount(g) - 1);
            const next = { ...g, purchaseCount: nextCount };
            // Al quedar sin compras vivas, deja de figurar como comprada.
            if (nextCount === 0) delete next.lastPurchasedAt;
            return next;
          });
        }

        transaction.update(userRef, userUpdate);
      } else {
        transaction.update(monthRef, {
          [`spentCents.${expense.category}`]: increment(-expense.amountCents),
        });
      }
    } else {
      const income = tx as IncomeTransaction;
      if (income.isDirectSavings) {
        // Un aporte directo nunca tocó totalIncomeCents ni los topes: se
        // revierte solo lo que sí movió, o se estaría descontando de un
        // lugar donde nunca se sumó.
        transaction.update(monthRef, {
          directSavingsCents: increment(-income.amountCents),
          incomeCount: increment(-1),
          ahorroContributedCents: increment(-income.amountCents),
        });
        transaction.update(userRef, {
          savingsTotalCents: increment(-income.amountCents),
        });
      } else {
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
    sourceId?: string;
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

    const newSplit = calculateProportionalSplit(
      newValues.amountCents,
      tx.amountCents,
      tx.distribution,
    );

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
      ...(newValues.sourceId ? { sourceId: newValues.sourceId } : {}),
      distribution: newSplit,
      description: newValues.description
        ? newValues.description
        : deleteField(),
    });
  });
}

/**
 * Retira de una meta de tipo "fondo" (colchón de emergencia). A diferencia de
 * una compra: el monto lo elige el usuario y no hace falta haber llegado al
 * objetivo - una emergencia no avisa ni cuesta siempre lo mismo.
 *
 * El tope es lo asignado a ese fondo. Si el usuario necesita más, primero
 * asigna más desde su ahorro sin asignar: así el retiro nunca se come plata
 * reservada para otra meta.
 */
export async function withdrawFromFund(
  userId: string,
  monthId: string,
  input: {
    goalId: string;
    amountCents: number;
    paymentMethod: string;
    description?: string;
    date: string;
  },
): Promise<void> {
  if (input.amountCents <= 0) {
    throw new Error("El monto debe ser mayor a 0");
  }

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
      throw new Error(`withdrawFromFund: perfil ${userId} no existe`);
    }
    if (!monthSnap.exists()) {
      throw new Error(`withdrawFromFund: mes ${monthId} no existe`);
    }
    if (monthSnap.data().closed) {
      throw new Error("No se puede modificar un mes cerrado");
    }

    const userProfile = userSnap.data() as User;
    const goals = userProfile.savingsGoals ?? [];
    const goal = goals.find((g) => g.id === input.goalId);
    if (!goal) {
      throw new Error("Ese fondo ya no existe");
    }
    if (getGoalKind(goal) !== "fondo") {
      throw new Error("Solo los fondos permiten retiros parciales");
    }

    const allocated = getGoalAllocated(goal);
    if (input.amountCents > allocated) {
      throw new Error("El monto supera lo asignado a este fondo");
    }

    const tx: WithFieldValue<ExpenseTransaction> = {
      type: "expense",
      category: "ahorro",
      subcategory: goal.name,
      paymentMethod: input.paymentMethod,
      amountCents: input.amountCents,
      transactionDate: input.date,
      serverDate: serverTimestamp(),
      localDate: new Date().toISOString(),
      ...(input.description ? { description: input.description } : {}),
    };
    transaction.set(txRef, tx);

    transaction.update(userRef, {
      savingsTotalCents: increment(-input.amountCents),
      savingsGoals: goals.map((g) =>
        g.id === goal.id
          ? { ...g, allocatedCents: allocated - input.amountCents }
          : g,
      ),
    });
  });
}

/**
 * Compra una meta de tipo "compra": se gasta completa y solo si esa meta ya
 * tiene asignado su objetivo. Se valida contra lo asignado a ESA meta, no
 * contra el ahorro total - si no, la misma plata habilitaría todas las metas
 * a la vez.
 *
 * Se recibe goalId (no el objeto) y se relee dentro de la transacción, para
 * no comprar con un nombre o monto que quedó viejo en la pantalla.
 *
 * allowAutoAssign es el atajo: si la meta no llega pero hay ahorro sin
 * asignar que cubre la diferencia, se asigna y se compra en una sola
 * operación. Nunca ocurre solo - la pantalla tiene que pedirlo explícitamente.
 */
export async function purchaseGoalExpense(
  userId: string,
  monthId: string,
  input: {
    goalId: string;
    paymentMethod: string;
    description?: string;
    date: string;
    allowAutoAssign?: boolean;
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
    const goals = userProfile.savingsGoals ?? [];
    const goal = goals.find((g) => g.id === input.goalId);
    if (!goal) {
      throw new Error("Esa meta ya no existe");
    }
    if (getGoalKind(goal) === "fondo") {
      throw new Error(
        "Un fondo no se compra: se retira el monto que necesites",
      );
    }

    const allocated = getGoalAllocated(goal);
    const missing = goal.targetCents - allocated;

    if (missing > 0) {
      if (!input.allowAutoAssign) {
        throw new Error("Esta meta todavía no tiene asignado su objetivo");
      }
      const unassigned = getUnassignedCents(
        userProfile.savingsTotalCents ?? 0,
        goals,
      );
      if (missing > unassigned) {
        throw new Error("No tienes suficiente ahorro sin asignar");
      }
    }

    const tx: WithFieldValue<ExpenseTransaction> = {
      type: "expense",
      category: "ahorro",
      subcategory: goal.name,
      paymentMethod: input.paymentMethod,
      amountCents: goal.targetCents,
      transactionDate: input.date,
      serverDate: serverTimestamp(),
      localDate: new Date().toISOString(),
      goalId: goal.id,
      ...(input.description ? { description: input.description } : {}),
    };
    transaction.set(txRef, tx);

    // Si sobraba asignado de más, ese resto queda en la meta: liberarlo solo
    // sería mover plata sin que nadie lo pidiera.
    const remainingAllocated = Math.max(0, allocated - goal.targetCents);
    transaction.update(userRef, {
      savingsTotalCents: increment(-goal.targetCents),
      savingsGoals: goals.map((g) =>
        g.id === goal.id
          ? {
              ...g,
              allocatedCents: remainingAllocated,
              purchaseCount: getPurchaseCount(g) + 1,
              lastPurchasedAt: input.date,
            }
          : g,
      ),
    });
  });
}
