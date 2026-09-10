import {
  collection,
  doc,
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
  generateFixedAmountInstallments,
  generateLoanInstallments,
  getBorrowedAvailableByCategory,
  reassignBorrowedBalance,
} from "@/utils/loans";
import type { Month } from "@/types/month";
import type {
  Loan,
  LoanDestinationCategory,
  LoanFundMovement,
  LoanFundMovementWithId,
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
  destinationCategory: LoanDestinationCategory;
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

export function watchLoanFundMovements(
  userId: string,
  loanId: string,
  onData: (movements: LoanFundMovementWithId[]) => void,
  onError?: (error: Error) => void,
): Unsubscribe {
  const movementsQuery = query(
    collection(db, "users", userId, "loans", loanId, "fundMovements"),
    orderBy("serverDate", "desc"),
  );
  return onSnapshot(
    movementsQuery,
    (snapshot) =>
      onData(
        snapshot.docs.map((item) => ({
          ...(item.data() as LoanFundMovement),
          id: item.id,
        })),
      ),
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
  const receivedMonthId = input.receivedDate.slice(0, 7);
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
      receivedDate: input.receivedDate,
      receivedMonthId,
      destinationCategory: input.destinationCategory,
      borrowedAvailableCents: input.amountReceivedCents,
      borrowedAvailableByCategory:
        input.destinationCategory === "necesidad"
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
      destinationCategory: input.destinationCategory,
      amountCents: input.amountReceivedCents,
      transactionDate: input.receivedDate,
      serverDate: serverTimestamp(),
      localDate: new Date().toISOString(),
      description: "Préstamo recibido",
    };

    transaction.set(loanRef, loan);
    transaction.set(receiptRef, receipt);
    transaction.update(monthRef, {
      [`capsCents.${input.destinationCategory}`]: increment(
        input.amountReceivedCents,
      ),
      [`borrowedCapsCents.${input.destinationCategory}`]: increment(
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
    if (
      loan.paidCents !== 0 ||
      (loan.fundMovementCount ?? 0) !== 0 ||
      loan.borrowedAvailableCents !== loan.amountReceivedCents
    ) {
      throw new Error(
        "Solo se puede cancelar un préstamo que todavía no tenga usos ni pagos.",
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
    if (
      input.amountCents <= 0 ||
      input.amountCents > availableByCategory[input.category]
    ) {
      throw new Error("El monto supera los fondos disponibles del préstamo");
    }

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
    };

    transaction.set(txRef, expense);
    transaction.update(monthRef, {
      [`spentCents.${input.category}`]: increment(input.amountCents),
      [`loanFundedSpentCents.${input.category}`]: increment(input.amountCents),
    });
    transaction.update(loanRef, {
      borrowedAvailableCents: increment(-input.amountCents),
      borrowedAvailableByCategory: {
        ...availableByCategory,
        [input.category]:
          availableByCategory[input.category] - input.amountCents,
      },
      updatedAt: serverTimestamp(),
    });
  });
}

export async function reassignLoanFunds(
  userId: string,
  monthId: string,
  loanId: string,
  input: {
    origin: LoanDestinationCategory;
    destination: LoanDestinationCategory;
    amountCents: number;
  },
): Promise<void> {
  if (input.origin === input.destination) {
    throw new Error("El origen y el destino deben ser distintos");
  }
  if (!Number.isInteger(input.amountCents) || input.amountCents <= 0) {
    throw new Error("El monto debe ser mayor a 0");
  }

  const loanRef = doc(db, "users", userId, "loans", loanId);
  const monthRef = doc(db, "users", userId, "months", monthId);
  const movementRef = doc(collection(loanRef, "fundMovements"));

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
    if (input.amountCents > availableByCategory[input.origin]) {
      throw new Error("El monto supera los fondos prestados disponibles");
    }
    const nextAvailable = reassignBorrowedBalance(
      availableByCategory,
      input.origin,
      input.destination,
      input.amountCents,
    );
    const loanName = loan.lender?.trim() || "Préstamo";
    const movement: WithFieldValue<LoanFundMovement> = {
      userId,
      loanId,
      loanName,
      origin: input.origin,
      destination: input.destination,
      amountCents: input.amountCents,
      transactionDate: toDateInputValue(),
      serverDate: serverTimestamp(),
    };

    transaction.update(loanRef, {
      borrowedAvailableByCategory: nextAvailable,
      fundMovementCount: increment(1),
      updatedAt: serverTimestamp(),
    });
    transaction.update(monthRef, {
      [`capsCents.${input.origin}`]: increment(-input.amountCents),
      [`capsCents.${input.destination}`]: increment(input.amountCents),
      [`borrowedCapsCents.${input.origin}`]: increment(-input.amountCents),
      [`borrowedCapsCents.${input.destination}`]: increment(input.amountCents),
    });
    transaction.set(movementRef, movement);
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
