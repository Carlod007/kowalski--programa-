import type { Category, Transaction } from "@/types/transaction";
import { CATEGORY_META } from "@/utils/category";
import { formatTime24, toDateInputValue } from "@/utils/date";
import { getRecordedDate } from "@/utils/transactionTiming";

export type HistoryExportRow = {
  operationDate: Date | null;
  recordedDate: Date | null;
  recordedTime: string;
  type: "Ingreso" | "Egreso";
  category: string;
  categoryKey: Category | null;
  subcategory: string;
  paymentMethod: string;
  moneyOrigin: string;
  amountCents: number;
  amountSoles: number;
  note: string;
  isLoanReceipt: boolean;
};

// Excel representa los días con una fecha UTC sin hora: no desplaza el día
// declarado al abrir el archivo en otra zona horaria.
function calendarDate(day: string): Date | null {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(day)) return null;
  const [year, month, date] = day.split("-").map(Number);
  const parsed = new Date(Date.UTC(year, month - 1, date));
  return parsed.toISOString().slice(0, 10) === day ? parsed : null;
}

export function buildHistoryRows(transactions: Transaction[]): HistoryExportRow[] {
  return transactions.map((tx) => {
    const recorded = getRecordedDate(tx);
    const recordedDay = recorded ? toDateInputValue(recorded) : "";
    const base = {
      operationDate: tx.transactionDate === recordedDay ? null : calendarDate(tx.transactionDate),
      recordedDate: calendarDate(recordedDay),
      recordedTime: recorded ? formatTime24(recorded) : "",
      amountCents: tx.amountCents,
      amountSoles: tx.amountCents / 100,
      note: tx.description ?? "",
      isLoanReceipt: tx.type === "loan",
    };

    if (tx.type === "income") {
      return {
        ...base, type: "Ingreso" as const, category: "", categoryKey: null,
        subcategory: "", paymentMethod: "", moneyOrigin: tx.source,
      };
    }
    if (tx.type === "loan") {
      return {
        ...base, type: "Ingreso" as const, category: "Préstamo recibido", categoryKey: null,
        subcategory: "", paymentMethod: "", moneyOrigin: tx.lender ?? "",
      };
    }

    const moneyOrigin = tx.fundedByLoanId
      ? `Financiado con ${tx.fundedByLoanName ?? "préstamo"}`
      : tx.loanPaymentId ? "Pago de préstamo" : "";
    return {
      ...base, type: "Egreso" as const,
      category: CATEGORY_META[tx.category].label,
      categoryKey: tx.category,
      subcategory: tx.subcategory,
      paymentMethod: tx.paymentMethod,
      moneyOrigin,
    };
  });
}

export function summarizeHistoryRows(rows: HistoryExportRow[]) {
  const categoryCents: Record<Category, number> = { necesidad: 0, ocio: 0, ahorro: 0 };
  let incomeCents = 0;
  let expenseCents = 0;
  let loanReceiptCents = 0;

  for (const row of rows) {
    if (row.type === "Ingreso") incomeCents += row.amountCents;
    else expenseCents += row.amountCents;
    if (row.categoryKey) categoryCents[row.categoryKey] += row.amountCents;
    if (row.isLoanReceipt) loanReceiptCents += row.amountCents;
  }
  return { incomeCents, expenseCents, loanReceiptCents, categoryCents };
}
