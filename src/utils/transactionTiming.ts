import type { TransactionBase, Transaction } from '@/types/transaction';
import { getMonthId, toDateInputValue } from './date';

export function validateTransactionTiming(
  monthId: string,
  date: string,
  now = new Date(),
): void {
  const parsed = new Date(`${date}T12:00:00`);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || !Number.isFinite(parsed.getTime()) || toDateInputValue(parsed) !== date) {
    throw new Error('Selecciona una fecha válida.');
  }
  if (monthId !== getMonthId(now) || date.slice(0, 7) !== monthId) {
    throw new Error('La fecha debe pertenecer al mes actual abierto.');
  }
  if (date > toDateInputValue(now)) {
    throw new Error('La fecha no puede estar en el futuro.');
  }
}

export function getRecordedDate(tx: Pick<TransactionBase, 'serverDate' | 'localDate'>): Date | null {
  const date = tx.serverDate?.toDate() ?? new Date(tx.localDate);
  return Number.isFinite(date.getTime()) ? date : null;
}

/** Ordena por el momento de creación; la fecha declarada solo desempata. */
export function compareRecordedTiming(a: TransactionBase, b: TransactionBase): number {
  return (getRecordedDate(a)?.getTime() ?? 0) - (getRecordedDate(b)?.getTime() ?? 0)
    || a.transactionDate.localeCompare(b.transactionDate);
}

export function canEditTransactionTiming(tx: Transaction): boolean {
  return tx.type !== 'loan' && !(tx.type === 'expense' && (tx.loanPaymentId || tx.creditCardStatementId));
}
