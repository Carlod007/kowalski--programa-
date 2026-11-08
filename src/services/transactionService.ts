import {
  collection,
  deleteField,
  doc,
  increment,
  runTransaction,
  serverTimestamp,
  type UpdateData,
  type WithFieldValue,
} from "firebase/firestore";
import { db } from "@/lib/firebase";
import { ensureCurrentMonth } from "@/services/monthService";
import { getMonthId, toDateInputValue } from "@/utils/date";
import { formatCents } from "@/utils/currency";
import {
  resolveTargetMonthIdForDate,
  validateTransactionTiming,
} from "@/utils/transactionTiming";
import {
  calculateDistribution,
  calculateProportionalSplit,
} from "@/utils/distribution";
import {
  getBorrowedAvailableByCategory,
  reverseLoanPayment,
} from "@/utils/loans";
import {
  getGoalAllocated,
  getGoalKind,
  getPurchaseCount,
  getUnassignedCents,
  restoreGoalAfterSavingsExpense,
} from "@/utils/savings";
import type { User } from "@/types/user";
import type { Month } from "@/types/month";
import type { Movement } from "@/types/movement";
import type { Loan, LoanPayment } from "@/types/loan";
import type { CreditCard } from "@/types/creditCard";
import type {
  Category,
  Distribution,
  ExpenseTransaction,
  IncomeTransaction,
  Transaction,
} from "@/types/transaction";

/**
 * Revertir un ingreso descuenta de ahorro y de los topes. Si ese dinero ya se
 * gastó o está reservado en metas, la resta dejaría saldos negativos o
 * sobreasignados. En vez de permitirlo y mostrar un estado roto, se frena y se
 * explica qué deshacer o liberar primero.
 */
function assertRevertible(
  income: IncomeTransaction,
  month: Month,
  profile: User | null,
): void {
  const ahorroToRevert = income.isDirectSavings
    ? income.amountCents
    : income.distribution.ahorro;

  const savingsTotal = profile?.savingsTotalCents ?? 0;
  if (ahorroToRevert > savingsTotal) {
    throw new Error(
      "No se puede borrar: parte de este ingreso ya se usó desde Ahorro. Deshaz primero esa compra o retiro.",
    );
  }

  const unassignedCents = getUnassignedCents(
    savingsTotal,
    profile?.savingsGoals ?? [],
  );
  if (ahorroToRevert > unassignedCents) {
    const toReleaseCents = ahorroToRevert - Math.max(0, unassignedCents);
    throw new Error(
      `No se puede borrar: parte de este ahorro está asignado a metas. Libera ${formatCents(toReleaseCents)} de tus metas primero.`,
    );
  }

  if (income.isDirectSavings) return;

  const ownedCapNecesidad =
    month.capsCents.necesidad - (month.borrowedCapsCents?.necesidad ?? 0);
  const ownedSpentNecesidad =
    month.spentCents.necesidad -
    (month.loanFundedSpentCents?.necesidad ?? 0);
  const availableOwnedNecesidad =
    ownedCapNecesidad -
    ownedSpentNecesidad -
    (month.carriedDeficitCents ?? 0);

  const ownedCapOcio =
    month.capsCents.ocio - (month.borrowedCapsCents?.ocio ?? 0);
  const ownedSpentOcio =
    month.spentCents.ocio - (month.loanFundedSpentCents?.ocio ?? 0);
  const availableOwnedOcio = ownedCapOcio - ownedSpentOcio;

  if (income.distribution.necesidad > availableOwnedNecesidad) {
    throw new Error(
      "No se puede borrar: el disponible propio de Necesidad de este mes ya no cubre este ingreso. Revisa los gastos o movimientos de excedente antes de borrarlo.",
    );
  }
  if (income.distribution.ocio > availableOwnedOcio) {
    throw new Error(
      "No se puede borrar: el disponible propio de Ocio de este mes ya no cubre este ingreso. Revisa los gastos o movimientos de excedente antes de borrarlo.",
    );
  }
}

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

    if (tx.type === "loan") {
      throw new Error(
        "El préstamo recibido se administra desde la pantalla de Préstamos.",
      );
    }

    // Si el egreso estaba vinculado a una meta, hay que restaurar su estado
    // además de devolver la plata. Se lee el perfil ANTES de escribir nada,
    // porque una transacción de Firestore no admite lecturas después de la
    // primera escritura.
    const userSnap = await transaction.get(userRef);

    const expenseTx = tx.type === "expense" ? tx : null;
    const userGoals = userSnap.exists()
      ? ((userSnap.data() as User).savingsGoals ?? [])
      : [];
    const savingsGoalId =
      expenseTx?.category === "ahorro"
        ? expenseTx.goalId ??
          // Retiros antiguos no guardaban goalId. Solo hacemos recuperación
          // segura para fondos con nombre idéntico; las compras requieren su
          // vínculo explícito para no alterar una meta equivocada.
          userGoals.find(
            (goal) =>
              getGoalKind(goal) === "fondo" &&
              goal.name === expenseTx.subcategory,
          )?.id
        : undefined;
    const linkedLoanId =
      expenseTx?.fundedByLoanId ??
      (expenseTx?.loanPaymentId ? expenseTx.loanId : undefined);
    const linkedLoanRef = linkedLoanId
      ? doc(db, "users", userId, "loans", linkedLoanId)
      : null;
    const linkedLoanSnap = linkedLoanRef
      ? await transaction.get(linkedLoanRef)
      : null;
    const paymentRef =
      expenseTx?.loanPaymentId && expenseTx.loanId
        ? doc(
            db,
            "users",
            userId,
            "loans",
            expenseTx.loanId,
            "payments",
            expenseTx.loanPaymentId,
          )
        : null;
    const paymentSnap = paymentRef ? await transaction.get(paymentRef) : null;
    const linkedCardRef = expenseTx?.creditCardId
      ? doc(db, "users", userId, "creditCards", expenseTx.creditCardId)
      : null;
    const linkedCardSnap = linkedCardRef
      ? await transaction.get(linkedCardRef)
      : null;

    const month = monthSnap.data() as Month;

    if (tx.type === "income") {
      assertRevertible(
        tx as IncomeTransaction,
        month,
        userSnap.exists() ? (userSnap.data() as User) : null,
      );
    }

    if (tx.type === "expense") {
      const expense = tx as ExpenseTransaction;
      if (expense.creditCardStatementId) {
        throw new Error(
          "Los intereses y cargos se corrigen desde su estado de cuenta.",
        );
      }
      if (expense.creditCardId) {
        if (!linkedCardRef || !linkedCardSnap?.exists()) {
          throw new Error("No se encontró la tarjeta vinculada");
        }
        const linkedCard = linkedCardSnap.data() as CreditCard;
        if (
          linkedCard.lastStatementClosingDate &&
          expense.transactionDate <= linkedCard.lastStatementClosingDate
        ) {
          throw new Error(
            "Esta compra ya pertenece a un estado de cuenta confirmado.",
          );
        }
        if (expense.amountCents > linkedCard.currentDebtCents) {
          throw new Error("La deuda de la tarjeta no permite revertir la compra");
        }
        transaction.update(linkedCardRef, {
          currentDebtCents: increment(-expense.amountCents),
          updatedAt: serverTimestamp(),
        });
      }
      if (expense.category === "ahorro") {
        const userUpdate: Record<string, unknown> = {
          savingsTotalCents: increment(expense.amountCents),
        };

        if (savingsGoalId && userSnap?.exists()) {
          userUpdate.savingsGoals = userGoals.map((g) => {
            if (g.id !== savingsGoalId) return g;
            return restoreGoalAfterSavingsExpense(g, expense.amountCents);
          });
        }

        transaction.update(userRef, userUpdate);
      } else {
        const monthUpdate: Record<string, unknown> = {
          [`spentCents.${expense.category}`]: increment(-expense.amountCents),
        };
        if (expense.fundedByLoanId) {
          monthUpdate[`loanFundedSpentCents.${expense.category}`] = increment(
            -expense.amountCents,
          );
        }
        transaction.update(monthRef, monthUpdate);
      }

      if (expense.fundedByLoanId) {
        if (!linkedLoanRef || !linkedLoanSnap?.exists()) {
          throw new Error("No se encontró el préstamo vinculado");
        }
        const linkedLoan = linkedLoanSnap.data() as Loan;
        const availableByCategory =
          getBorrowedAvailableByCategory(linkedLoan);
        if (expense.category === "ahorro") {
          throw new Error("Un gasto financiado no puede pertenecer a Ahorro");
        }
        transaction.update(linkedLoanRef, {
          borrowedAvailableCents: increment(expense.amountCents),
          borrowedAvailableByCategory: {
            ...availableByCategory,
            [expense.category]:
              availableByCategory[expense.category] + expense.amountCents,
          },
          updatedAt: serverTimestamp(),
        });
      }

      if (expense.loanPaymentId) {
        if (
          !linkedLoanRef ||
          !linkedLoanSnap?.exists() ||
          !paymentRef ||
          !paymentSnap?.exists()
        ) {
          throw new Error("No se encontró el pago de préstamo vinculado");
        }
        const loan = linkedLoanSnap.data() as Loan;
        const payment = paymentSnap.data() as LoanPayment;
        transaction.update(linkedLoanRef, {
          installments: reverseLoanPayment(
            loan.installments,
            payment.allocations,
          ),
          paidCents: increment(-payment.amountCents),
          updatedAt: serverTimestamp(),
        });
        transaction.delete(paymentRef);
      }
    } else if (tx.type === "income") {
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
          ...((month.distributedIncomeCount ?? 1) > 0
            ? { distributedIncomeCount: increment(-1) }
            : {}),
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
    tags?: string[];
  },
): Promise<void> {
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

    if (tx.category === "ahorro" && delta !== 0) {
      throw new Error(
        "El monto de un egreso de Ahorro no se puede editar. Bórralo y regístralo de nuevo.",
      );
    }

    const linkedCardRef = tx.creditCardId
      ? doc(db, "users", userId, "creditCards", tx.creditCardId)
      : null;
    const linkedCardSnap = linkedCardRef
      ? await transaction.get(linkedCardRef)
      : null;

    if ((tx.fundedByLoanId || tx.loanPaymentId) && delta !== 0) {
      throw new Error(
        "El monto de una operación vinculada a un préstamo no se edita. Bórrala y regístrala de nuevo.",
      );
    }
    if (tx.creditCardStatementId) {
      throw new Error(
        "Los intereses y cargos se corrigen desde su estado de cuenta.",
      );
    }
    if (tx.creditCardId) {
      if (!linkedCardRef || !linkedCardSnap?.exists()) {
        throw new Error("No se encontró la tarjeta vinculada");
      }
      const linkedCard = linkedCardSnap.data() as CreditCard;
      if (
        linkedCard.lastStatementClosingDate &&
        tx.transactionDate <= linkedCard.lastStatementClosingDate
      ) {
        throw new Error(
          "Esta compra ya pertenece a un estado de cuenta confirmado.",
        );
      }
      if (linkedCard.currentDebtCents + delta < 0) {
        throw new Error("La deuda de la tarjeta no permite este cambio");
      }
      transaction.update(linkedCardRef, {
        currentDebtCents: increment(delta),
        updatedAt: serverTimestamp(),
      });
    }

    if (tx.category !== "ahorro") {
      transaction.update(monthRef, {
        [`spentCents.${tx.category}`]: increment(delta),
      });
    }

    transaction.update(txRef, {
      amountCents: newValues.amountCents,
      subcategory: newValues.subcategory,
      paymentMethod: tx.creditCardId
        ? tx.paymentMethod
        : newValues.paymentMethod,
      description: newValues.description
        ? newValues.description
        : deleteField(),
      tags: newValues.tags?.length ? newValues.tags : deleteField(),
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
    const [monthSnap, txSnap, userSnap] = await Promise.all([
      transaction.get(monthRef),
      transaction.get(txRef),
      transaction.get(userRef),
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

    const newSplit: Distribution = tx.isDirectSavings
      ? { necesidad: 0, ocio: 0, ahorro: newValues.amountCents }
      : calculateProportionalSplit(
          newValues.amountCents,
          tx.amountCents,
          tx.distribution,
        );

    // Bajar el monto descuenta de ahorro y de los topes, igual que borrarlo.
    // Si ese dinero ya se gastó o está reservado en metas, la resta dejaría
    // saldos negativos o sobreasignados.
    const month = monthSnap.data() as Month;
    const profile = userSnap.exists() ? (userSnap.data() as User) : null;
    const savingsTotal = profile?.savingsTotalCents ?? 0;
    const ahorroDelta = newSplit.ahorro - tx.distribution.ahorro;
    if (ahorroDelta < 0) {
      const ahorroReduction = -ahorroDelta;
      if (ahorroReduction > savingsTotal) {
        throw new Error(
          "No se puede bajar tanto: parte de este ingreso ya se usó desde Ahorro. Deshaz primero esa compra o retiro.",
        );
      }
      const unassignedCents = getUnassignedCents(
        savingsTotal,
        profile?.savingsGoals ?? [],
      );
      if (ahorroReduction > unassignedCents) {
        const toReleaseCents = ahorroReduction - Math.max(0, unassignedCents);
        throw new Error(
          `No se puede bajar tanto: parte de este ahorro está asignado a metas. Libera ${formatCents(toReleaseCents)} de tus metas primero.`,
        );
      }
    }

    if (!tx.isDirectSavings) {
      const necesidadDelta = newSplit.necesidad - tx.distribution.necesidad;
      const ownedCapNecesidad =
        month.capsCents.necesidad - (month.borrowedCapsCents?.necesidad ?? 0);
      const ownedSpentNecesidad =
        month.spentCents.necesidad -
        (month.loanFundedSpentCents?.necesidad ?? 0);
      const availableOwnedNecesidad =
        ownedCapNecesidad -
        ownedSpentNecesidad -
        (month.carriedDeficitCents ?? 0);
      if (necesidadDelta < 0 && -necesidadDelta > availableOwnedNecesidad) {
        throw new Error(
          "No se puede bajar tanto: el disponible propio de Necesidad de este mes ya no lo cubre.",
        );
      }

      const ocioDelta = newSplit.ocio - tx.distribution.ocio;
      const ownedCapOcio =
        month.capsCents.ocio - (month.borrowedCapsCents?.ocio ?? 0);
      const ownedSpentOcio =
        month.spentCents.ocio - (month.loanFundedSpentCents?.ocio ?? 0);
      const availableOwnedOcio = ownedCapOcio - ownedSpentOcio;
      if (ocioDelta < 0 && -ocioDelta > availableOwnedOcio) {
        throw new Error(
          "No se puede bajar tanto: el disponible propio de Ocio de este mes ya no lo cubre.",
        );
      }
    }

    if (tx.isDirectSavings) {
      transaction.update(monthRef, {
        directSavingsCents: increment(newValues.amountCents - tx.amountCents),
        ahorroContributedCents: increment(ahorroDelta),
      });
    } else {
      transaction.update(monthRef, {
        totalIncomeCents: increment(newValues.amountCents - tx.amountCents),
        "capsCents.necesidad": increment(
          newSplit.necesidad - tx.distribution.necesidad,
        ),
        "capsCents.ocio": increment(newSplit.ocio - tx.distribution.ocio),
        ahorroContributedCents: increment(ahorroDelta),
      });
    }
    transaction.update(userRef, {
      savingsTotalCents: increment(ahorroDelta),
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
    date: string;
    description?: string;
    allowAutoAssign?: boolean;
  },
): Promise<void> {
  if (input.amountCents <= 0) {
    throw new Error("El monto debe ser mayor a 0");
  }
  validateTransactionTiming(monthId, input.date);

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
      throw new Error("Esta meta se usa para una compra completa, no por partes");
    }

    const allocated = getGoalAllocated(goal);
    const missing = Math.max(0, input.amountCents - allocated);

    if (missing > 0) {
      if (!input.allowAutoAssign) {
        throw new Error("El monto supera lo que tienes en este fondo");
      }
      const unassigned = getUnassignedCents(
        userProfile.savingsTotalCents ?? 0,
        goals,
      );
      if (missing > unassigned) {
        throw new Error("No tienes suficiente ahorro sin asignar");
      }
    }

    if (input.amountCents > (userProfile.savingsTotalCents ?? 0)) {
      throw new Error(
        "El monto supera tu ahorro total disponible. Revisa si tu ahorro está sobreasignado.",
      );
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
      goalId: goal.id,
      ...(input.description ? { description: input.description } : {}),
    };
    transaction.set(txRef, tx);

    // Si faltaba asignado y se autorizó completarlo desde "sin asignar", el
    // fondo queda en 0; si alcanzaba, solo baja en lo retirado. En ambos casos
    // el dinero que sale es input.amountCents.
    const nextAllocated = Math.max(0, allocated - input.amountCents);
    transaction.update(userRef, {
      savingsTotalCents: increment(-input.amountCents),
      savingsGoals: goals.map((g) =>
        g.id === goal.id ? { ...g, allocatedCents: nextAllocated } : g,
      ),
    });
  });
}

/**
 * Compra una meta de tipo "compra" (un bien concreto). El monto siempre es el
 * objetivo completo (`goal.targetCents`). Al comprar:
 * - se descuenta del ahorro acumulado del usuario,
 * - se consume lo asignado a la meta (vuelve a 0 para poder ahorrar de nuevo si
 *   quiere repetirla, o dejarla en "Comprada"),
 * - se incrementa `purchaseCount` y se actualiza `lastPurchasedAt`.
 *
 * No toca `spentCents` del mes porque esto no salió del presupuesto mensual de
 * Necesidad/Ocio: salió del ahorro acumulado.
 */
export async function purchaseGoalExpense(
  userId: string,
  monthId: string,
  input: {
    goalId: string;
    paymentMethod: string;
    date: string;
    description?: string;
    allowAutoAssign?: boolean;
    actualAmountCents?: number;
    releaseRemainder?: boolean;
  },
): Promise<void> {
  if (
    input.actualAmountCents !== undefined &&
    (!Number.isInteger(input.actualAmountCents) || input.actualAmountCents <= 0)
  ) {
    throw new Error("El monto debe ser mayor a 0");
  }
  validateTransactionTiming(monthId, input.date);

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

    const purchaseAmountCents = input.actualAmountCents ?? goal.targetCents;
    const releaseRemainder = input.releaseRemainder ?? true;
    const allocated = getGoalAllocated(goal);
    const missing = Math.max(0, purchaseAmountCents - allocated);

    if (missing > 0) {
      if (input.actualAmountCents === undefined && !input.allowAutoAssign) {
        throw new Error("Esta meta todavía no tiene asignado su objetivo");
      }
      if (input.allowAutoAssign === false) {
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

    if (purchaseAmountCents > (userProfile.savingsTotalCents ?? 0)) {
      throw new Error(
        "El monto de la meta supera tu ahorro total disponible. Revisa si tu ahorro está sobreasignado.",
      );
    }

    const tx: WithFieldValue<ExpenseTransaction> = {
      type: "expense",
      category: "ahorro",
      subcategory: goal.name,
      paymentMethod: input.paymentMethod,
      amountCents: purchaseAmountCents,
      transactionDate: input.date,
      serverDate: serverTimestamp(),
      localDate: new Date().toISOString(),
      goalId: goal.id,
      ...(input.description ? { description: input.description } : {}),
    };
    transaction.set(txRef, tx);

    // Si actualAmountCents < allocatedCents y releaseRemainder es true (por defecto),
    // se pone allocatedCents en 0 y la diferencia (allocated - purchaseAmountCents)
    // queda liberada automáticamente en "sin asignar" (savingsTotalCents - sum(allocated)).
    const remainingAllocated =
      purchaseAmountCents < allocated
        ? releaseRemainder
          ? 0
          : allocated - purchaseAmountCents
        : 0;

    transaction.update(userRef, {
      savingsTotalCents: increment(-purchaseAmountCents),
      savingsGoals: goals.map((g) =>
        g.id === goal.id
          ? {
              ...g,
              allocatedCents: remainingAllocated,
              purchaseCount: getPurchaseCount(g) + 1,
              lastPurchasedAt:
                goal.lastPurchasedAt && goal.lastPurchasedAt > input.date
                  ? goal.lastPurchasedAt
                  : input.date,
            }
          : g,
      ),
    });
  });
}

/** Etiqueta fija de los aportes directos: no ensucia las fuentes del usuario. */
const DIRECT_SAVINGS_LABEL = "Aporte directo";

export interface RegisterIncomeInput {
  monthId?: string;
  amountCents: number;
  date?: string;
  description?: string;
  isDirectSavings?: boolean;
  source?: string;
  sourceId?: string;
}

export async function registerIncome(
  userId: string,
  input: RegisterIncomeInput,
): Promise<{ distribution: Distribution }> {
  if (input.amountCents <= 0) {
    throw new Error("El monto debe ser mayor a 0");
  }

  const isDirectSavings = Boolean(input.isDirectSavings);
  if (!isDirectSavings && !input.source && !input.sourceId) {
    throw new Error("Selecciona una fuente");
  }

  const transactionDate = input.date || toDateInputValue();
  const monthId = resolveTargetMonthIdForDate(transactionDate, input.monthId);
  validateTransactionTiming(monthId, transactionDate);

  const description = input.description?.trim();
  const userRef = doc(db, "users", userId);
  const monthRef = doc(db, "users", userId, "months", monthId);

  const executeWrite = async (
    fallbackMonth?: Month,
  ): Promise<
    | { monthMissing: true }
    | { monthMissing: false; distribution: Distribution }
  > => {
    const txRef = doc(
      collection(db, "users", userId, "months", monthId, "transactions"),
    );
    return runTransaction(db, async (transaction) => {
      const monthSnap = await transaction.get(monthRef);
      const month = monthSnap.exists()
        ? (monthSnap.data() as Month)
        : fallbackMonth;
      if (!month) {
        return { monthMissing: true };
      }
      if (month.closed) {
        throw new Error("No se puede modificar un mes cerrado");
      }

      if (isDirectSavings) {
        // Va entero al ahorro: no toca los topes, totalIncomeCents ni
        // distributedIncomeCount, para no congelar ni alterar los porcentajes
        // del mes con plata que nunca se repartió.
        const distribution: Distribution = {
          necesidad: 0,
          ocio: 0,
          ahorro: input.amountCents,
        };
        const tx: WithFieldValue<IncomeTransaction> = {
          type: "income",
          source: DIRECT_SAVINGS_LABEL,
          transactionDate,
          amountCents: input.amountCents,
          distribution,
          isDirectSavings: true,
          serverDate: serverTimestamp(),
          localDate: new Date().toISOString(),
          ...(description ? { description } : {}),
        };
        transaction.set(txRef, tx);

        const monthUpdate: UpdateData<Month> = {
          directSavingsCents: increment(input.amountCents),
          incomeCount: increment(1),
          ahorroContributedCents: increment(input.amountCents),
        };
        transaction.update(monthRef, monthUpdate);
        transaction.update(userRef, {
          savingsTotalCents: increment(input.amountCents),
        });
        return { monthMissing: false, distribution };
      }

      const distribution = calculateDistribution(
        input.amountCents,
        month.distribution,
      );
      const tx: WithFieldValue<IncomeTransaction> = {
        type: "income",
        source: input.source ?? "",
        ...(input.sourceId !== undefined ? { sourceId: input.sourceId } : {}),
        transactionDate,
        amountCents: input.amountCents,
        distribution,
        serverDate: serverTimestamp(),
        localDate: new Date().toISOString(),
        ...(description ? { description } : {}),
      };
      transaction.set(txRef, tx);

      const monthUpdate: UpdateData<Month> = {
        totalIncomeCents: increment(input.amountCents),
        incomeCount: increment(1),
        distributedIncomeCount: increment(1),
        "capsCents.necesidad": increment(distribution.necesidad),
        "capsCents.ocio": increment(distribution.ocio),
        ahorroContributedCents: increment(distribution.ahorro),
      };
      transaction.update(monthRef, monthUpdate);
      transaction.update(userRef, {
        savingsTotalCents: increment(distribution.ahorro),
      });
      return { monthMissing: false, distribution };
    });
  };

  const firstAttempt = await executeWrite();
  if (!firstAttempt.monthMissing) {
    return { distribution: firstAttempt.distribution };
  }

  if (monthId !== getMonthId()) {
    throw new Error(`registerIncome: mes ${monthId} no existe`);
  }

  const ensuredMonth = await ensureCurrentMonth(userId);
  const secondAttempt = await executeWrite(ensuredMonth);
  if (secondAttempt.monthMissing) {
    throw new Error(`registerIncome: mes ${monthId} no existe`);
  }
  return { distribution: secondAttempt.distribution };
}

export interface RegisterExpenseInput {
  monthId?: string;
  category: "necesidad" | "ocio";
  subcategory: string;
  paymentMethod: string;
  amountCents: number;
  date?: string;
  description?: string;
  tags?: string[];
}

export async function registerExpense(
  userId: string,
  input: RegisterExpenseInput,
): Promise<void> {
  if (input.amountCents <= 0) {
    throw new Error("El monto debe ser mayor a 0");
  }
  if (!input.subcategory) {
    throw new Error("Selecciona una subcategoría");
  }
  if (!input.paymentMethod) {
    throw new Error("Selecciona un método de pago");
  }

  const transactionDate = input.date || toDateInputValue();
  const monthId = resolveTargetMonthIdForDate(transactionDate, input.monthId);
  validateTransactionTiming(monthId, transactionDate);

  const description = input.description?.trim();
  const tags = input.tags ?? [];
  const monthRef = doc(db, "users", userId, "months", monthId);

  const executeWrite = async (
    fallbackMonth?: Month,
  ): Promise<{ monthMissing: boolean }> => {
    const txRef = doc(
      collection(db, "users", userId, "months", monthId, "transactions"),
    );
    return runTransaction(db, async (transaction) => {
      const monthSnap = await transaction.get(monthRef);
      const month = monthSnap.exists()
        ? (monthSnap.data() as Month)
        : fallbackMonth;
      if (!month) {
        return { monthMissing: true };
      }
      if (month.closed) {
        throw new Error("No se puede modificar un mes cerrado");
      }

      const tx: WithFieldValue<ExpenseTransaction> = {
        type: "expense",
        category: input.category,
        subcategory: input.subcategory,
        paymentMethod: input.paymentMethod,
        amountCents: input.amountCents,
        transactionDate,
        serverDate: serverTimestamp(),
        localDate: new Date().toISOString(),
        ...(description ? { description } : {}),
        ...(tags.length > 0 ? { tags } : {}),
      };
      transaction.set(txRef, tx);

      const monthUpdate: UpdateData<Month> = {
        [`spentCents.${input.category}`]: increment(input.amountCents),
      };
      transaction.update(monthRef, monthUpdate);
      return { monthMissing: false };
    });
  };

  const firstAttempt = await executeWrite();
  if (!firstAttempt.monthMissing) {
    return;
  }

  if (monthId !== getMonthId()) {
    throw new Error(`registerExpense: mes ${monthId} no existe`);
  }

  const ensuredMonth = await ensureCurrentMonth(userId);
  const secondAttempt = await executeWrite(ensuredMonth);
  if (secondAttempt.monthMissing) {
    throw new Error(`registerExpense: mes ${monthId} no existe`);
  }
}

export interface RecordClosedMonthAdjustmentInput {
  referenceMonthId: string;
  category: Category;
  deltaCents: number;
  reason: string;
  allowOverSpentCap?: boolean;
  currentMonthId?: string;
}

/**
 * Registra un asiento de ajuste auditable en el mes ABIERTO actual vinculado a
 * un mes cerrado (`referenceMonthId`), ajustando `capsCents` (Necesidad u Ocio)
 * o `savingsTotalCents` / `ahorroContributedCents` (Ahorro) sin modificar jamás
 * el documento del mes cerrado.
 */
export async function recordClosedMonthAdjustment(
  userId: string,
  input: RecordClosedMonthAdjustmentInput,
): Promise<void> {
  const trimmedReason = input.reason?.trim() ?? "";
  if (!trimmedReason) {
    throw new Error("El motivo del ajuste es obligatorio");
  }
  if (trimmedReason.length > 200) {
    throw new Error("El motivo no puede superar los 200 caracteres");
  }
  if (!Number.isInteger(input.deltaCents) || input.deltaCents === 0) {
    throw new Error("El ajuste debe ser un monto entero distinto de 0");
  }
  if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(input.referenceMonthId)) {
    throw new Error("Mes de referencia inválido");
  }
  if (
    input.category !== "necesidad" &&
    input.category !== "ocio" &&
    input.category !== "ahorro"
  ) {
    throw new Error("Categoría inválida");
  }

  const openMonthId = input.currentMonthId ?? getMonthId();
  if (input.referenceMonthId === openMonthId) {
    throw new Error(
      "El mes de referencia debe ser un mes cerrado distinto del mes actual",
    );
  }

  const userRef = doc(db, "users", userId);
  const refMonthRef = doc(
    db,
    "users",
    userId,
    "months",
    input.referenceMonthId,
  );
  const openMonthRef = doc(db, "users", userId, "months", openMonthId);

  const executeAdjustment = async (): Promise<{ openMonthMissing: boolean }> => {
    const movementRef = doc(
      collection(db, "users", userId, "months", openMonthId, "movements"),
    );

    return runTransaction(db, async (transaction) => {
      const [userSnap, refMonthSnap, openMonthSnap] = await Promise.all([
        transaction.get(userRef),
        transaction.get(refMonthRef),
        transaction.get(openMonthRef),
      ]);

      if (!userSnap.exists()) {
        throw new Error(
          `recordClosedMonthAdjustment: perfil ${userId} no existe`,
        );
      }
      if (!refMonthSnap.exists()) {
        throw new Error(
          `El mes de referencia ${input.referenceMonthId} no existe`,
        );
      }
      const refMonth = refMonthSnap.data() as Month;
      if (!refMonth.closed) {
        throw new Error(
          "Solo se pueden registrar asientos de ajuste para meses cerrados",
        );
      }
      if (!openMonthSnap.exists()) {
        return { openMonthMissing: true };
      }

      const openMonth = openMonthSnap.data() as Month;
      if (openMonth.closed) {
        throw new Error("No se puede modificar un mes cerrado");
      }

      const userProfile = userSnap.data() as User;

      if (input.category === "ahorro") {
        const savingsTotal = userProfile.savingsTotalCents ?? 0;
        const nextSavingsTotal = savingsTotal + input.deltaCents;
        if (nextSavingsTotal < 0) {
          throw new Error(
            "El ajuste no puede dejar tu ahorro total en negativo",
          );
        }
        const unassigned = getUnassignedCents(
          savingsTotal,
          userProfile.savingsGoals ?? [],
        );
        if (input.deltaCents < 0 && -input.deltaCents > unassigned) {
          const toReleaseCents = -input.deltaCents - Math.max(0, unassigned);
          throw new Error(
            `El ajuste supera tu ahorro sin asignar. Libera ${formatCents(toReleaseCents)} de tus metas primero.`,
          );
        }

        transaction.update(userRef, {
          savingsTotalCents: increment(input.deltaCents),
        });

        if (input.deltaCents > 0) {
          transaction.update(openMonthRef, {
            ahorroContributedCents: increment(input.deltaCents),
          });
        } else {
          const currentContributed = openMonth.ahorroContributedCents ?? 0;
          const revertible = Math.min(-input.deltaCents, currentContributed);
          if (revertible > 0) {
            transaction.update(openMonthRef, {
              ahorroContributedCents: increment(-revertible),
            });
          }
        }
      } else {
        const cat = input.category;
        const label = cat === "necesidad" ? "Necesidad" : "Ocio";
        const currentCap = openMonth.capsCents[cat];
        const borrowedCap = openMonth.borrowedCapsCents?.[cat] ?? 0;
        const nextCap = currentCap + input.deltaCents;
        const nextOwnedCap = nextCap - borrowedCap;

        if (nextCap < 0 || nextOwnedCap < 0) {
          throw new Error(
            `El ajuste no puede dejar el tope propio de ${label} en negativo`,
          );
        }

        const loanFundedSpent = openMonth.loanFundedSpentCents?.[cat] ?? 0;
        const ownedSpent = Math.max(
          0,
          openMonth.spentCents[cat] - loanFundedSpent,
        );
        const carriedDeficit =
          cat === "necesidad" ? (openMonth.carriedDeficitCents ?? 0) : 0;
        const committedOwned = ownedSpent + carriedDeficit;

        if (
          input.deltaCents < 0 &&
          nextOwnedCap < committedOwned &&
          !input.allowOverSpentCap
        ) {
          throw new Error(
            `Este ajuste deja el tope propio de ${label} (${formatCents(nextOwnedCap)}) por debajo de lo ya gastado este mes (${formatCents(committedOwned)}). Confirma explícitamente si deseas continuar.`,
          );
        }

        transaction.update(openMonthRef, {
          [`capsCents.${cat}`]: increment(input.deltaCents),
        });
      }

      const absAmount = Math.abs(input.deltaCents);
      const movement: WithFieldValue<Movement> = {
        userId,
        monthId: openMonthId,
        origin: input.category,
        destination: input.category,
        amountCents: absAmount,
        reason: trimmedReason,
        kind: "closed_month_adjustment",
        referenceMonthId: input.referenceMonthId,
        category: input.category,
        deltaCents: input.deltaCents,
        transactionDate: toDateInputValue(),
        serverDate: serverTimestamp(),
      };
      transaction.set(movementRef, movement);
      return { openMonthMissing: false };
    });
  };

  const firstAttempt = await executeAdjustment();
  if (!firstAttempt.openMonthMissing) {
    return;
  }

  if (openMonthId === getMonthId()) {
    await ensureCurrentMonth(userId);
    const secondAttempt = await executeAdjustment();
    if (!secondAttempt.openMonthMissing) {
      return;
    }
  }
  throw new Error(`recordClosedMonthAdjustment: mes ${openMonthId} no existe`);
}
