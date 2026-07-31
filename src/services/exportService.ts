import {
  collection,
  documentId,
  getDocs,
  orderBy,
  query,
  where,
} from "firebase/firestore";
import { db } from "@/lib/firebase";
import { formatMonthLabel } from "@/utils/date";
import { CATEGORY_META } from "@/utils/category";
import type {
  ExpenseTransaction,
  IncomeTransaction,
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

    for (const txDoc of txSnap.docs) {
      const tx = txDoc.data() as Transaction;
      if (tx.type === "income") {
        const income = tx as IncomeTransaction;
        incomeRows.push(
          [
            monthLabel,
            income.transactionDate,
            csvEscape(income.source),
            csvEscape(income.description ?? ""),
            centsToPlain(income.amountCents),
          ].join(","),
        );
      } else {
        const expense = tx as ExpenseTransaction;
        expenseRows.push(
          [
            monthLabel,
            expense.transactionDate,
            CATEGORY_META[expense.category].label,
            csvEscape(expense.subcategory),
            csvEscape(expense.description ?? ""),
            csvEscape(expense.paymentMethod),
            centsToPlain(expense.amountCents),
          ].join(","),
        );
      }
    }
  }

  const lines = [
    "INGRESOS",
    "Mes,Fecha,Fuente,Descripción,Monto",
    ...incomeRows,
    "",
    "EGRESOS",
    "Mes,Fecha,Categoría,Subcategoría,Descripción,Método de pago,Monto",
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
