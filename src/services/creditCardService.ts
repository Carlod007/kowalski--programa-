import {
  collection,
  deleteField,
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
import type { Month } from "@/types/month";
import type { ExpenseTransaction } from "@/types/transaction";
import type {
  CreditCard,
  CreditCardPayment,
  CreditCardPaymentMode,
  CreditCardPaymentWithId,
  CreditCardStatement,
  CreditCardStatementSummary,
  CreditCardStatementWithId,
  CreditCardWithId,
} from "@/types/creditCard";
import { getCreditCardDisplayName } from "@/utils/creditCards";

const DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;

function assertDate(value: string, label: string): void {
  const parsed = new Date(`${value}T00:00:00Z`);
  if (
    !DATE_PATTERN.test(value) ||
    Number.isNaN(parsed.getTime()) ||
    parsed.toISOString().slice(0, 10) !== value
  ) {
    throw new Error(`Revisa la ${label}`);
  }
}

export function watchCreditCards(
  userId: string,
  onData: (cards: CreditCardWithId[]) => void,
  onError?: (error: Error) => void,
): Unsubscribe {
  const cardsQuery = query(
    collection(db, "users", userId, "creditCards"),
    orderBy("createdAt", "desc"),
  );
  return onSnapshot(
    cardsQuery,
    (snapshot) =>
      onData(
        snapshot.docs.map((item) => ({
          ...(item.data() as CreditCard),
          id: item.id,
        })),
      ),
    (error) => onError?.(error),
  );
}

export function watchCreditCardStatements(
  userId: string,
  cardId: string,
  onData: (statements: CreditCardStatementWithId[]) => void,
  onError?: (error: Error) => void,
): Unsubscribe {
  const statementsQuery = query(
    collection(db, "users", userId, "creditCards", cardId, "statements"),
    orderBy("closingDate", "desc"),
  );
  return onSnapshot(
    statementsQuery,
    (snapshot) =>
      onData(
        snapshot.docs.map((item) => ({
          ...(item.data() as CreditCardStatement),
          id: item.id,
        })),
      ),
    (error) => onError?.(error),
  );
}

export function watchCreditCardPayments(
  userId: string,
  cardId: string,
  onData: (payments: CreditCardPaymentWithId[]) => void,
  onError?: (error: Error) => void,
): Unsubscribe {
  const paymentsQuery = query(
    collection(db, "users", userId, "creditCards", cardId, "payments"),
    orderBy("serverDate", "desc"),
  );
  return onSnapshot(
    paymentsQuery,
    (snapshot) =>
      onData(
        snapshot.docs.map((item) => ({
          ...(item.data() as CreditCardPayment),
          id: item.id,
        })),
      ),
    (error) => onError?.(error),
  );
}

export async function createCreditCard(
  userId: string,
  input: {
    issuer: string;
    name: string;
    creditLimitCents: number;
    closingDay: number;
    dueDay: number;
  },
): Promise<string> {
  if (!input.issuer.trim() || !input.name.trim()) {
    throw new Error("Completa la entidad y el nombre de la tarjeta");
  }
  if (!Number.isInteger(input.creditLimitCents) || input.creditLimitCents <= 0) {
    throw new Error("La línea de crédito debe ser mayor a 0");
  }
  if (
    !Number.isInteger(input.closingDay) ||
    input.closingDay < 1 ||
    input.closingDay > 31 ||
    !Number.isInteger(input.dueDay) ||
    input.dueDay < 1 ||
    input.dueDay > 31
  ) {
    throw new Error("Los días de corte y vencimiento deben estar entre 1 y 31");
  }

  const cardRef = doc(collection(db, "users", userId, "creditCards"));
  const card: WithFieldValue<CreditCard> = {
    userId,
    issuer: input.issuer.trim(),
    name: input.name.trim(),
    creditLimitCents: input.creditLimitCents,
    currentDebtCents: 0,
    closingDay: input.closingDay,
    dueDay: input.dueDay,
    createdAt: serverTimestamp(),
    updatedAt: serverTimestamp(),
  };

  await runTransaction(db, async (transaction) => {
    transaction.set(cardRef, card);
  });
  return cardRef.id;
}

export async function registerCreditCardPurchase(
  userId: string,
  monthId: string,
  input: {
    cardId: string;
    category: "necesidad" | "ocio";
    subcategory: string;
    amountCents: number;
    date: string;
    description?: string;
  },
): Promise<void> {
  if (!Number.isInteger(input.amountCents) || input.amountCents <= 0) {
    throw new Error("El monto debe ser mayor a 0");
  }
  assertDate(input.date, "fecha de compra");
  const cardRef = doc(db, "users", userId, "creditCards", input.cardId);
  const monthRef = doc(db, "users", userId, "months", monthId);
  const txRef = doc(
    collection(db, "users", userId, "months", monthId, "transactions"),
  );

  await runTransaction(db, async (transaction) => {
    const [cardSnapshot, monthSnapshot] = await Promise.all([
      transaction.get(cardRef),
      transaction.get(monthRef),
    ]);
    if (!cardSnapshot.exists()) throw new Error("La tarjeta ya no existe");
    if (!monthSnapshot.exists()) throw new Error("El mes todavía no existe");
    if ((monthSnapshot.data() as Month).closed) {
      throw new Error("No se puede registrar una compra en un mes cerrado");
    }

    const card = cardSnapshot.data() as CreditCard;
    const cardName = getCreditCardDisplayName(card);
    const expense: WithFieldValue<ExpenseTransaction> = {
      type: "expense",
      category: input.category,
      subcategory: input.subcategory,
      paymentMethod: cardName,
      amountCents: input.amountCents,
      transactionDate: input.date,
      serverDate: serverTimestamp(),
      localDate: new Date().toISOString(),
      creditCardId: input.cardId,
      creditCardName: cardName,
      ...(input.description ? { description: input.description } : {}),
    };

    transaction.set(txRef, expense);
    transaction.update(monthRef, {
      [`spentCents.${input.category}`]: increment(input.amountCents),
    });
    transaction.update(cardRef, {
      currentDebtCents: increment(input.amountCents),
      updatedAt: serverTimestamp(),
    });
  });
}

export async function confirmCreditCardStatement(
  userId: string,
  cardId: string,
  input: {
    closingDate: string;
    dueDate: string;
    statementBalanceCents: number;
    minimumPaymentCents: number;
    totalPaymentCents: number;
    interestChargesCents: number;
    recordedMonthId: string;
    recordedDate: string;
  },
): Promise<void> {
  const amounts = [
    input.statementBalanceCents,
    input.minimumPaymentCents,
    input.totalPaymentCents,
    input.interestChargesCents,
  ];
  assertDate(input.closingDate, "fecha de corte");
  assertDate(input.dueDate, "fecha de vencimiento");
  assertDate(input.recordedDate, "fecha de registro");
  if (input.dueDate <= input.closingDate) {
    throw new Error("El vencimiento debe ser posterior al corte");
  }
  if (
    amounts.some((amount) => !Number.isInteger(amount)) ||
    input.statementBalanceCents <= 0 ||
    input.minimumPaymentCents < 0 ||
    input.totalPaymentCents <= 0 ||
    input.minimumPaymentCents > input.totalPaymentCents ||
    input.interestChargesCents < 0
  ) {
    throw new Error("Revisa los importes del estado de cuenta");
  }

  const cardRef = doc(db, "users", userId, "creditCards", cardId);
  const statementRef = doc(collection(cardRef, "statements"));
  const monthRef = doc(db, "users", userId, "months", input.recordedMonthId);
  const interestTxRef =
    input.interestChargesCents > 0
      ? doc(collection(monthRef, "transactions"))
      : null;

  await runTransaction(db, async (transaction) => {
    const [cardSnapshot, monthSnapshot] = await Promise.all([
      transaction.get(cardRef),
      transaction.get(monthRef),
    ]);
    if (!cardSnapshot.exists()) throw new Error("La tarjeta ya no existe");
    if (!monthSnapshot.exists()) throw new Error("El mes todavía no existe");
    if ((monthSnapshot.data() as Month).closed) {
      throw new Error("No se puede registrar cargos en un mes cerrado");
    }

    const card = cardSnapshot.data() as CreditCard;
    if (
      card.lastStatementClosingDate &&
      input.closingDate <= card.lastStatementClosingDate
    ) {
      throw new Error("La fecha de corte debe ser posterior al último estado");
    }
    const debtAfterCharges =
      card.currentDebtCents + input.interestChargesCents;
    if (input.statementBalanceCents > debtAfterCharges) {
      throw new Error(
        "El saldo facturado supera la deuda registrada. Registra primero las compras faltantes.",
      );
    }
    if (input.totalPaymentCents > debtAfterCharges) {
      throw new Error("El pago total no puede superar la deuda actual");
    }

    const cardName = getCreditCardDisplayName(card);
    const summary: CreditCardStatementSummary = {
      id: statementRef.id,
      closingDate: input.closingDate,
      dueDate: input.dueDate,
      statementBalanceCents: input.statementBalanceCents,
      minimumPaymentCents: input.minimumPaymentCents,
      totalPaymentCents: input.totalPaymentCents,
      paidCents: 0,
    };
    const statement: WithFieldValue<CreditCardStatement> = {
      ...summary,
      userId,
      cardId,
      cardName,
      interestChargesCents: input.interestChargesCents,
      recordedMonthId: input.recordedMonthId,
      ...(interestTxRef ? { interestTransactionId: interestTxRef.id } : {}),
      createdAt: serverTimestamp(),
    };

    transaction.set(statementRef, statement);
    transaction.update(cardRef, {
      currentDebtCents: debtAfterCharges,
      activeStatement: summary,
      lastStatementClosingDate: input.closingDate,
      updatedAt: serverTimestamp(),
    });

    if (interestTxRef && input.interestChargesCents > 0) {
      const expense: WithFieldValue<ExpenseTransaction> = {
        type: "expense",
        category: "necesidad",
        subcategory: "Intereses y cargos de tarjeta",
        paymentMethod: cardName,
        amountCents: input.interestChargesCents,
        transactionDate: input.recordedDate,
        serverDate: serverTimestamp(),
        localDate: new Date().toISOString(),
        description: `Estado de cuenta del ${input.closingDate}`,
        creditCardId: cardId,
        creditCardName: cardName,
        creditCardStatementId: statementRef.id,
        creditCardChargeKind: "interest-fees",
      };
      transaction.set(interestTxRef, expense);
      transaction.update(monthRef, {
        "spentCents.necesidad": increment(input.interestChargesCents),
      });
    }
  });
}

export async function recordCreditCardPayment(
  userId: string,
  cardId: string,
  input: {
    amountCents: number;
    paymentDate: string;
    mode: CreditCardPaymentMode;
  },
): Promise<void> {
  if (!Number.isInteger(input.amountCents) || input.amountCents <= 0) {
    throw new Error("El pago debe ser mayor a 0");
  }
  assertDate(input.paymentDate, "fecha del pago");
  const cardRef = doc(db, "users", userId, "creditCards", cardId);
  const paymentRef = doc(collection(cardRef, "payments"));

  await runTransaction(db, async (transaction) => {
    const cardSnapshot = await transaction.get(cardRef);
    if (!cardSnapshot.exists()) throw new Error("La tarjeta ya no existe");
    const card = cardSnapshot.data() as CreditCard;
    if (input.amountCents > card.currentDebtCents) {
      throw new Error("El pago supera la deuda actual");
    }

    const active = card.activeStatement;
    const statementRef = active
      ? doc(cardRef, "statements", active.id)
      : null;
    const statementSnapshot = statementRef
      ? await transaction.get(statementRef)
      : null;
    if (statementRef && !statementSnapshot?.exists()) {
      throw new Error("No se encontró el estado de cuenta activo");
    }

    const statementPending = active
      ? Math.max(0, active.totalPaymentCents - active.paidCents)
      : 0;
    const statementAppliedCents = Math.min(
      input.amountCents,
      statementPending,
    );
    const nextPaidCents = active
      ? active.paidCents + statementAppliedCents
      : 0;
    const cardName = getCreditCardDisplayName(card);
    const payment: WithFieldValue<CreditCardPayment> = {
      userId,
      cardId,
      cardName,
      ...(active ? { statementId: active.id } : {}),
      mode: input.mode,
      amountCents: input.amountCents,
      statementAppliedCents,
      paymentDate: input.paymentDate,
      serverDate: serverTimestamp(),
    };

    transaction.set(paymentRef, payment);
    transaction.update(cardRef, {
      currentDebtCents: increment(-input.amountCents),
      ...(active
        ? { activeStatement: { ...active, paidCents: nextPaidCents } }
        : {}),
      updatedAt: serverTimestamp(),
    });
    if (statementRef && active) {
      transaction.update(statementRef, { paidCents: nextPaidCents });
    }
  });
}

export async function deleteCreditCardPayment(
  userId: string,
  cardId: string,
  paymentId: string,
): Promise<void> {
  const cardRef = doc(db, "users", userId, "creditCards", cardId);
  const paymentRef = doc(cardRef, "payments", paymentId);

  await runTransaction(db, async (transaction) => {
    const [cardSnapshot, paymentSnapshot] = await Promise.all([
      transaction.get(cardRef),
      transaction.get(paymentRef),
    ]);
    if (!cardSnapshot.exists() || !paymentSnapshot.exists()) {
      throw new Error("No se encontró el pago o la tarjeta");
    }
    const card = cardSnapshot.data() as CreditCard;
    const payment = paymentSnapshot.data() as CreditCardPayment;
    if (payment.statementId && card.activeStatement?.id !== payment.statementId) {
      throw new Error(
        "Los pagos de estados anteriores quedan cerrados como historial.",
      );
    }

    const statementRef = payment.statementId
      ? doc(cardRef, "statements", payment.statementId)
      : null;
    const statementSnapshot = statementRef
      ? await transaction.get(statementRef)
      : null;
    if (statementRef && !statementSnapshot?.exists()) {
      throw new Error("No se encontró el estado de cuenta del pago");
    }

    const active = card.activeStatement;
    const nextPaidCents = active
      ? Math.max(0, active.paidCents - payment.statementAppliedCents)
      : 0;
    transaction.update(cardRef, {
      currentDebtCents: increment(payment.amountCents),
      ...(active
        ? { activeStatement: { ...active, paidCents: nextPaidCents } }
        : {}),
      updatedAt: serverTimestamp(),
    });
    if (statementRef && active) {
      transaction.update(statementRef, { paidCents: nextPaidCents });
    }
    transaction.delete(paymentRef);
  });
}

export async function cancelLatestCreditCardStatement(
  userId: string,
  cardId: string,
  statementId: string,
): Promise<void> {
  const cardRef = doc(db, "users", userId, "creditCards", cardId);
  const statementsSnapshot = await getDocs(
    query(collection(cardRef, "statements"), orderBy("closingDate", "desc")),
  );
  const previousStatement = statementsSnapshot.docs
    .filter((item) => item.id !== statementId)
    .map((item) => item.data() as CreditCardStatement)
    .sort((a, b) => b.closingDate.localeCompare(a.closingDate))[0];
  const statementRef = doc(cardRef, "statements", statementId);

  await runTransaction(db, async (transaction) => {
    const [cardSnapshot, statementSnapshot] = await Promise.all([
      transaction.get(cardRef),
      transaction.get(statementRef),
    ]);
    if (!cardSnapshot.exists() || !statementSnapshot.exists()) {
      throw new Error("No se encontró el estado de cuenta o la tarjeta");
    }
    const card = cardSnapshot.data() as CreditCard;
    const statement = statementSnapshot.data() as CreditCardStatement;
    if (card.activeStatement?.id !== statementId) {
      throw new Error("Solo se puede corregir el estado de cuenta más reciente");
    }
    if (statement.paidCents !== 0) {
      throw new Error("Borra primero los pagos vinculados a este estado");
    }
    if (statement.interestChargesCents > card.currentDebtCents) {
      throw new Error(
        "La deuda actual no permite revertir estos intereses y cargos.",
      );
    }

    const monthRef = doc(
      db,
      "users",
      userId,
      "months",
      statement.recordedMonthId,
    );
    const monthSnapshot = await transaction.get(monthRef);
    if (!monthSnapshot.exists()) throw new Error("El mes ya no existe");
    if ((monthSnapshot.data() as Month).closed) {
      throw new Error("No se puede corregir un cargo de un mes cerrado");
    }

    const previousSummary: CreditCardStatementSummary | null = previousStatement
      ? {
          id: previousStatement.id,
          closingDate: previousStatement.closingDate,
          dueDate: previousStatement.dueDate,
          statementBalanceCents: previousStatement.statementBalanceCents,
          minimumPaymentCents: previousStatement.minimumPaymentCents,
          totalPaymentCents: previousStatement.totalPaymentCents,
          paidCents: previousStatement.paidCents,
        }
      : null;
    transaction.update(cardRef, {
      currentDebtCents: increment(-statement.interestChargesCents),
      activeStatement: previousSummary ?? deleteField(),
      lastStatementClosingDate:
        previousSummary?.closingDate ?? deleteField(),
      updatedAt: serverTimestamp(),
    });

    if (statement.interestTransactionId) {
      transaction.delete(
        doc(monthRef, "transactions", statement.interestTransactionId),
      );
      transaction.update(monthRef, {
        "spentCents.necesidad": increment(-statement.interestChargesCents),
      });
    }
    transaction.delete(statementRef);
  });
}

export async function deleteUnusedCreditCard(
  userId: string,
  cardId: string,
): Promise<void> {
  const cardRef = doc(db, "users", userId, "creditCards", cardId);
  const [statements, payments] = await Promise.all([
    getDocs(collection(cardRef, "statements")),
    getDocs(collection(cardRef, "payments")),
  ]);
  if (!statements.empty || !payments.empty) {
    throw new Error("La tarjeta ya tiene estados de cuenta o pagos registrados");
  }
  await runTransaction(db, async (transaction) => {
    const cardSnapshot = await transaction.get(cardRef);
    if (!cardSnapshot.exists()) throw new Error("La tarjeta ya no existe");
    if ((cardSnapshot.data() as CreditCard).currentDebtCents !== 0) {
      throw new Error("Borra primero las compras registradas con esta tarjeta");
    }
    transaction.delete(cardRef);
  });
}
