import type { TransactionBase, Transaction } from '@/types/transaction';
import { getMonthId, shiftMonthId, toDateInputValue } from './date';

export const GRACE_WINDOW_DAYS = 3;

export function isWithinGraceWindow(now = new Date()): boolean {
  const day = now.getDate();
  return day >= 1 && day <= GRACE_WINDOW_DAYS;
}

export function getGraceDeadlineDate(pendingMonthId: string): string {
  const nextMonthId = shiftMonthId(pendingMonthId, 1);
  return `${nextMonthId}-${String(GRACE_WINDOW_DAYS).padStart(2, '0')}`;
}

export function resolveTargetMonthIdForDate(
  date: string,
  requestedMonthId?: string,
  now = new Date(),
): string {
  const currentMonthId = getMonthId(now);
  const prevMonthId = shiftMonthId(currentMonthId, -1);
  const dateMonthId = /^\d{4}-\d{2}-\d{2}$/.test(date) ? date.slice(0, 7) : '';
  if (
    dateMonthId === prevMonthId &&
    isWithinGraceWindow(now) &&
    (!requestedMonthId ||
      requestedMonthId === currentMonthId ||
      requestedMonthId === prevMonthId)
  ) {
    return prevMonthId;
  }
  return requestedMonthId ?? currentMonthId;
}

export function validateTransactionTiming(
  monthId: string,
  date: string,
  now = new Date(),
): void {
  const parsed = new Date(`${date}T12:00:00`);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || !Number.isFinite(parsed.getTime()) || toDateInputValue(parsed) !== date) {
    throw new Error('Selecciona una fecha válida.');
  }
  const currentMonthId = getMonthId(now);
  const prevMonthId = shiftMonthId(currentMonthId, -1);
  const allowedPreviousMonth =
    monthId === prevMonthId && isWithinGraceWindow(now);
  if (
    (monthId !== currentMonthId && !allowedPreviousMonth) ||
    date.slice(0, 7) !== monthId
  ) {
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
