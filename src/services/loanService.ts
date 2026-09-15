import {
  collection,
  doc,
  getDocs,
  increment,
  onSnapshot,
  orderBy,
  query,
  runTransaction,
  serverTimestamp,
  type Unsubscribe,
  type WithFieldValue,
} from "firebase/firestore";
import { db } from "@/lib/firebase";
import { getUnassignedCents } from "@/utils/savings";
import { toDateInputValue } from "@/utils/date";
import {
  allocateLoanPayment,
  buildCustomLoanInstallments,
  canCancelUnusedLoan,
  generateFixedAmountInstallments,
  generateLoanInstallments,
  getBorrowedAvailableByCategory,
  consumeBorrowedBalance,
} from "@/utils/loans";
import type { Month } from "@/types/month";
import type {
  Loan,
  LoanDestinationCategory,
  LoanPayment,
  LoanPaymentSource,
  LoanWithId,
} from "@/types/loan";
import type { User } from "@/types/user";
import type {
  ExpenseTransaction,
  LoanReceiptTransaction,
} from "@/types/transaction";

type CreateLoanCommon = {
  lender?: string;
  amountReceivedCents: number;
  receivedDate: string;
  importedExisting?: boolean;
  /** Conservado para compatibilidad; la interfaz nueva usa un fondo compartido. */
  destinationCategory?: LoanDestinationCategory;
};

type CreateLoanInput = CreateLoanCommon &
  (
    | {
        scheduleType: "fixed-known";
        installmentAmountCents: number;
        installmentCount: number;
        firstDueDate: string;
      }
    | {
        scheduleType: "total-known";
        totalToRepayCents: number;
        installmentCount: number;
        firstDueDate: string;
      }
    | {
        scheduleType: "custom";
        installments: { dueDate: string; amountCents: number }[];
      }
  );

export function watchLoans(
  userId: string,
  onData: (loans: LoanWithId[]) => void,
  onError?: (error: Error) => void,
): Unsubscribe {
  const loansQuery = query(
    collection(db, "users", userId, "loans"),
    orderBy("createdAt", "desc"),
  );
  return onSnapshot(
    loansQuery,
    (snapshot) => {
      onData(
        snapshot.docs.map((item) => ({
          ...(item.data() as Loan),
          id: item.id,
        })),
      );
    },
    (error) => onError?.(error),
  );
}

export async function createLoan(
  userId: string,
  input: CreateLoanInput,
): Promise<string> {
  if (input.amountReceivedCents <= 0) {
    throw new Error("El monto recibido debe ser mayor a 0");
  }
  if (!/^\d{4}-\d{2}-\d{2}$/.test(input.receivedDate)) {
    throw new Error("Ingresa una fecha de recepción válida");
  }
  const registrationDate = toDateInputValue();
  if (input.receivedDate > registrationDate) {
    throw new Error("La fecha de recepción no puede estar en el futuro");
  }
  const receivedMonthId = (
    input.importedExisting ? registrationDate : input.receivedDate
  ).slice(0, 7);
  // La distribución interna sigue existiendo para conservar el cierre mensual
  // y préstamos antiguos, pero el usuario consume un único fondo compartido.
  const destinationCategory = input.destinationCategory ?? "necesidad";
  const monthRef = doc(db, "users", userId, "months", receivedMonthId);
  const loanRef = doc(collection(db, "users", userId, "loans"));
  const receiptRef = doc(
    collection(
      db,
      "users",
      userId,
      "months",
      receivedMonthId,
      "transactions",
    ),
  );
  let installments;
  if (input.scheduleType === "fixed-known") {
    installments = generateFixedAmountInstallments(
      input.installmentAmountCents,
      input.installmentCount,
      input.firstDueDate,
    );
  } else if (input.scheduleType === "total-known") {
    installments = generateLoanInstallments(
      input.totalToRepayCents,
      input.installmentCount,
      input.firstDueDate,
    );
  } else {
    installments = buildCustomLoanInstallments(input.installments);
  }
  if (installments.some((item) => item.dueDate < input.receivedDate)) {
    throw new Error("Los vencimientos no pueden ser anteriores a la recepción");
  }
  const totalToRepayCents = installments.reduce(
    (sum, item) => sum + item.amountCents,
    0,
  );
  if (totalToRepayCents < input.amountReceivedCents) {
    throw new Error("El total a devolver no puede ser menor al recibido");
  }

  await runTransaction(db, async (transaction) => {
    const monthSnapshot = await transaction.get(monthRef);
    if (!monthSnapshot.exists()) {
      throw new Error("El mes de recepción todavía no existe");
    }
    if ((monthSnapshot.data() as Month).closed) {
      throw new Error("No se puede registrar un préstamo en un mes cerrado");
    }

    const loan: WithFieldValue<Loan> = {
      userId,
      ...(input.lender ? { lender: input.lender } : {}),
      amountReceivedCents: input.amountReceivedCents,
      totalToRepayCents,
      scheduleType: input.scheduleType,
      ...(input.importedExisting ? { importedExisting: true } : {}),
      receivedDate: input.receivedDate,
      receivedMonthId,
      destinationCategory,
      borrowedAvailableCents: input.amountReceivedCents,
      borrowedAvailableByCategory:
        destinationCategory === "necesidad"
          ? { necesidad: input.amountReceivedCents, ocio: 0 }
          : { necesidad: 0, ocio: input.amountReceivedCents },
      paidCents: 0,
      fundMovementCount: 0,
      installments,
      receiptTransactionId: receiptRef.id,
      createdAt: serverTimestamp(),
      updatedAt: serverTimestamp(),
    };
    const receipt: WithFieldValue<LoanReceiptTransaction> = {
      type: "loan",
      loanId: loanRef.id,
      ...(input.lender ? { lender: input.lender } : {}),
      destinationCategory,
      amountCents: input.amountReceivedCents,
      transactionDate: input.importedExisting
        ? registrationDate
        : input.receivedDate,
      serverDate: serverTimestamp(),
      localDate: new Date().toISOString(),
      description: input.importedExisting
        ? "Préstamo anterior incorporado"
        : "Préstamo recibido",
    };

    transaction.set(loanRef, loan);
    transaction.set(receiptRef, receipt);
    transaction.update(monthRef, {
      [`capsCents.${destinationCategory}`]: increment(
        input.amountReceivedCents,
      ),
      [`borrowedCapsCents.${destinationCategory}`]: increment(
        input.amountReceivedCents,
      ),
    });
  });

  return loanRef.id;
}

export async function cancelUnusedLoan(
  userId: string,
  loanId: string,
): Promise<void> {
  const loanRef = doc(db, "users", userId, "loans", loanId);
  const fundMovementsSnapshot = await getDocs(
    collection(db, "users", userId, "loans", loanId, "fundMovements"),
  );

  // Firestore admite como máximo 500 escrituras por transacción. Además de
  // los movimientos se actualiza el mes y se borran la entrada y el préstamo.
  if (fundMovementsSnapshot.size > 497) {
    throw new Error(
      "El préstamo tiene demasiadas reasignaciones para cancelarlo de una sola vez.",
    );
  }

  await runTransaction(db, async (transaction) => {
    const loanSnapshot = await transaction.get(loanRef);
    if (!loanSnapshot.exists()) throw new Error("El préstamo ya no existe");
    const loan = loanSnapshot.data() as Loan;
    const monthRef = doc(
      db,
      "users",
      userId,
      "months",
      loan.receivedMonthId,
    );
    const receiptRef = doc(
      db,
      "users",
      userId,
      "months",
      loan.receivedMonthId,
      "transactions",
      loan.receiptTransactionId,
    );
    const monthSnapshot = await transaction.get(monthRef);
    if (!monthSnapshot.exists()) throw new Error("El mes de recepción no existe");
    if ((monthSnapshot.data() as Month).closed) {
      throw new Error("No se puede cancelar un préstamo de un mes cerrado");
    }
    if (!canCancelUnusedLoan(loan)) {
      throw new Error(
        "Solo se puede cancelar un préstamo que todavía no tenga usos ni pagos.",
      );
    }
    if ((loan.fundMovementCount ?? 0) !== fundMovementsSnapshot.size) {
      throw new Error(
        "Las reasignaciones cambiaron durante la cancelación. Inténtalo nuevamente.",
      );
    }

    const availableByCategory = getBorrowedAvailableByCategory(loan);

    transaction.update(monthRef, {
      "capsCents.necesidad": increment(-availableByCategory.necesidad),
      "capsCents.ocio": increment(-availableByCategory.ocio),
      "borrowedCapsCents.necesidad": increment(
        -availableByCategory.necesidad,
      ),
      "borrowedCapsCents.ocio": increment(-availableByCategory.ocio),
    });
    fundMovementsSnapshot.docs.forEach((movement) => {
      transaction.delete(movement.ref);
    });
    transaction.delete(receiptRef);
    transaction.delete(loanRef);
  });
}

export async function registerLoanFundedExpense(
  userId: string,
  monthId: string,
  input: {
    loanId: string;
    category: LoanDestinationCategory;
    subcategory: string;
    paymentMethod: string;
    amountCents: number;
    date: string;
    description?: string;
    tags?: string[];
  },
): Promise<void> {
  const loanRef = doc(db, "users", userId, "loans", input.loanId);
  const monthRef = doc(db, "users", userId, "months", monthId);
  const txRef = doc(
    collection(db, "users", userId, "months", monthId, "transactions"),
  );

  await runTransaction(db, async (transaction) => {
    const [loanSnapshot, monthSnapshot] = await Promise.all([
      transaction.get(loanRef),
      transaction.get(monthRef),
    ]);
    if (!loanSnapshot.exists()) throw new Error("El préstamo ya no existe");
    if (!monthSnapshot.exists()) throw new Error("El mes no existe");
    const loan = loanSnapshot.data() as Loan;
    const month = monthSnapshot.data() as Month;
    if (month.closed) throw new Error("No se puede modificar un mes cerrado");
    const availableByCategory = getBorrowedAvailableByCategory(loan);
    if (input.amountCents <= 0 || input.amountCents > loan.borrowedAvailableCents) {
      throw new Error("El monto supera los fondos disponibles del préstamo");
    }
    const consumed = consumeBorrowedBalance(
      availableByCategory,
      input.category,
      input.amountCents,
    );
    const otherCategory: LoanDestinationCategory =
      input.category === "necesidad" ? "ocio" : "necesidad";

    const loanName = loan.lender?.trim() || "Préstamo";
    const expense: WithFieldValue<ExpenseTransaction> = {
      type: "expense",
      category: input.category,
      subcategory: input.subcategory,
      paymentMethod: input.paymentMethod,
      amountCents: input.amountCents,
      transactionDate: input.date,
      serverDate: serverTimestamp(),
      localDate: new Date().toISOString(),
      fundedByLoanId: input.loanId,
      fundedByLoanName: loanName,
      ...(input.description ? { description: input.description } : {}),
      ...(input.tags?.length ? { tags: input.tags } : {}),
    };

    transaction.set(txRef, expense);
    transaction.update(monthRef, {
      [`spentCents.${input.category}`]: increment(input.amountCents),
      [`loanFundedSpentCents.${input.category}`]: increment(input.amountCents),
      [`capsCents.${input.category}`]: increment(consumed.transferredCents),
      [`capsCents.${otherCategory}`]: increment(-consumed.transferredCents),
      [`borrowedCapsCents.${input.category}`]: increment(
        consumed.transferredCents,
      ),
      [`borrowedCapsCents.${otherCategory}`]: increment(
        -consumed.transferredCents,
      ),
    });
    transaction.update(loanRef, {
      borrowedAvailableCents: increment(-input.amountCents),
      borrowedAvailableByCategory: consumed.available,
      updatedAt: serverTimestamp(),
    });
  });
}

export async function recordLoanPayment(
  userId: string,
  monthId: string,
  loanId: string,
  input: {
    amountCents: number;
    paymentDate: string;
    sourceCategory: LoanPaymentSource;
    paymentMethod: string;
    description?: string;
  },
): Promise<void> {
  const loanRef = doc(db, "users", userId, "loans", loanId);
  const userRef = doc(db, "users", userId);
  const monthRef = doc(db, "users", userId, "months", monthId);
  const paymentRef = doc(collection(loanRef, "payments"));
  const txRef = doc(
    collection(db, "users", userId, "months", monthId, "transactions"),
  );

  await runTransaction(db, async (transaction) => {
    const [loanSnapshot, userSnapshot, monthSnapshot] = await Promise.all([
      transaction.get(loanRef),
      transaction.get(userRef),
      transaction.get(monthRef),
    ]);
    if (!loanSnapshot.exists()) throw new Error("El préstamo ya no existe");
    if (!userSnapshot.exists()) throw new Error("El perfil no existe");
    if (!monthSnapshot.exists()) throw new Error("El mes no existe");
    const loan = loanSnapshot.data() as Loan;
    const user = userSnapshot.data() as User;
    const month = monthSnapshot.data() as Month;
    if (month.closed) throw new Error("No se puede modificar un mes cerrado");

    const allocation = allocateLoanPayment(loan.installments, input.amountCents);
    if (input.sourceCategory === "ahorro") {
      const unassigned = getUnassignedCents(
        user.savingsTotalCents ?? 0,
        user.savingsGoals ?? [],
      );
      if (input.amountCents > unassigned) {
        throw new Error(
          "El pago supera tu ahorro sin asignar. Libera dinero de tus metas primero.",
        );
      }
    }

    const loanName = loan.lender?.trim() || "Préstamo";
    const expense: WithFieldValue<ExpenseTransaction> = {
      type: "expense",
      category: input.sourceCategory,
      subcategory: `Pago de préstamo: ${loanName}`,
      paymentMethod: input.paymentMethod,
      amountCents: input.amountCents,
      transactionDate: input.paymentDate,
      serverDate: serverTimestamp(),
      localDate: new Date().toISOString(),
      loanPaymentId: paymentRef.id,
      loanId,
      ...(input.description ? { description: input.description } : {}),
    };
    const payment: WithFieldValue<LoanPayment> = {
      userId,
      loanId,
      loanName,
      monthId,
      amountCents: input.amountCents,
      paymentDate: input.paymentDate,
      sourceCategory: input.sourceCategory,
      paymentMethod: input.paymentMethod,
      allocations: allocation.allocations,
      transactionId: txRef.id,
      serverDate: serverTimestamp(),
      localDate: new Date().toISOString(),
      ...(input.description ? { description: input.description } : {}),
    };

    transaction.set(txRef, expense);
    transaction.set(paymentRef, payment);
    transaction.update(loanRef, {
      installments: allocation.installments,
      paidCents: increment(input.amountCents),
      updatedAt: serverTimestamp(),
    });
    if (input.sourceCategory === "ahorro") {
      transaction.update(userRef, {
        savingsTotalCents: increment(-input.amountCents),
      });
    } else {
      transaction.update(monthRef, {
        [`spentCents.${input.sourceCategory}`]: increment(input.amountCents),
      });
    }
  });
}
