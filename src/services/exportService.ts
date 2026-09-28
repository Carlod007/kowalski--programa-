import {
  collection,
  documentId,
  getDocs,
  orderBy,
  query,
  where,
} from "firebase/firestore";
import { db } from "@/lib/firebase";
import { formatMonthLabel, formatTime24, toDateInputValue } from "@/utils/date";
import { CATEGORY_META } from "@/utils/category";
import { compareRecordedTiming, getRecordedDate } from "@/utils/transactionTiming";
import type {
  ExpenseTransaction,
  IncomeTransaction,
  LoanReceiptTransaction,
  Transaction,
} from "@/types/transaction";

export async function getAvailableMonths(userId: string): Promise<string[]> {
  const monthsRef = collection(db, "users", userId, "months");
  const q = query(monthsRef, orderBy(documentId()));
  const snap = await getDocs(q);
  return snap.docs.map((d) => d.id);
}

function csvEscape(value: string): string {
  if (value.includes(",") || value.includes('"') || value.includes("\n")) {
    return `"${value.replace(/"/g, '""')}"`;
  }
  return value;
}

function centsToPlain(cents: number): string {
  return (cents / 100).toFixed(2);
}

export async function buildHistoryCsv(
  userId: string,
  fromMonthId: string,
  toMonthId: string,
): Promise<string> {
  const monthsRef = collection(db, "users", userId, "months");
  const q = query(
    monthsRef,
    where(documentId(), ">=", fromMonthId),
    where(documentId(), "<=", toMonthId),
    orderBy(documentId()),
  );
  const monthDocs = await getDocs(q);

  const incomeRows: string[] = [];
  const loanRows: string[] = [];
  const expenseRows: string[] = [];

  for (const monthDoc of monthDocs.docs) {
    const monthId = monthDoc.id;
    const monthLabel = formatMonthLabel(monthId);
    const txRef = collection(
      db,
      "users",
      userId,
      "months",
      monthId,
      "transactions",
    );
    const txSnap = await getDocs(txRef);

    const ordered = txSnap.docs.map((item) => ({ id: item.id, tx: item.data() as Transaction }))
      .sort((a, b) => compareRecordedTiming(a.tx, b.tx) || a.id.localeCompare(b.id));
    for (const { tx } of ordered) {
      const recordedDate = getRecordedDate(tx);
      const recordedDay = recordedDate ? toDateInputValue(recordedDate) : "";
      const recordedTime = recordedDate ? formatTime24(recordedDate) : "";
      const declaredDate = recordedDay && tx.transactionDate === recordedDay
        ? ""
        : tx.transactionDate;
      if (tx.type === "income") {
        const income = tx as IncomeTransaction;
        incomeRows.push(
          [
            monthLabel,
            declaredDate,
            recordedDay,
            recordedTime,
            csvEscape(income.source),
            csvEscape(income.description ?? ""),
            centsToPlain(income.amountCents),
          ].join(","),
        );
      } else if (tx.type === "loan") {
        const loan = tx as LoanReceiptTransaction;
        loanRows.push(
          [
            monthLabel,
            declaredDate,
            recordedDay,
            recordedTime,
            csvEscape(loan.lender ?? ""),
            centsToPlain(loan.amountCents),
          ].join(","),
        );
      } else {
        const expense = tx as ExpenseTransaction;
        const loanRelation = expense.fundedByLoanId
          ? `Financiado con ${expense.fundedByLoanName ?? "préstamo"}`
          : expense.loanPaymentId
            ? "Pago de préstamo"
            : "";
        expenseRows.push(
          [
            monthLabel,
            declaredDate,
            recordedDay,
            recordedTime,
            CATEGORY_META[expense.category].label,
            csvEscape(expense.subcategory),
            csvEscape(expense.description ?? ""),
            csvEscape((expense.tags ?? []).join(" | ")),
            csvEscape(expense.paymentMethod),
            csvEscape(loanRelation),
            centsToPlain(expense.amountCents),
          ].join(","),
        );
      }
    }
  }

  const lines = [
    "INGRESOS",
    "Mes,Fecha de operación (si distinta),Fecha de registro (local),Hora de registro (local, 24 h),Fuente,Descripción,Monto",
    ...incomeRows,
    "",
    "PRÉSTAMOS RECIBIDOS",
    "Mes,Fecha de operación (si distinta),Fecha de registro (local),Hora de registro (local, 24 h),Banco o entidad,Monto recibido",
    ...loanRows,
    "",
    "EGRESOS",
    "Mes,Fecha de operación (si distinta),Fecha de registro (local),Hora de registro (local, 24 h),Categoría,Subcategoría,Descripción,Etiquetas,Método de pago,Relación con préstamo,Monto",
    ...expenseRows,
  ];

  return lines.join("\n");
}

export function downloadCsv(csvContent: string, filename: string): void {
  const blob = new Blob(["\uFEFF" + csvContent], {
    type: "text/csv;charset=utf-8;",
  });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
  URL.revokeObjectURL(url);
}
