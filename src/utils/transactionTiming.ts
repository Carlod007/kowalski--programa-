import type { TransactionBase, Transaction } from '@/types/transaction';
import {
  DEFAULT_TIME_ZONE,
  getMonthId,
  getZonedDateParts,
  now,
  shiftMonthId,
  toDateInputValue,
} from './date';

export const GRACE_WINDOW_DAYS = 3;

export function isWithinGraceWindow(
  nowDate: Date = now(),
  timeZone: string = DEFAULT_TIME_ZONE,
): boolean {
  const day = getZonedDateParts(nowDate, timeZone).day;
  return day >= 1 && day <= GRACE_WINDOW_DAYS;
}

export function getGraceDeadlineDate(pendingMonthId: string): string {
  const nextMonthId = shiftMonthId(pendingMonthId, 1);
  return `${nextMonthId}-${String(GRACE_WINDOW_DAYS).padStart(2, '0')}`;
}

export function resolveTargetMonthIdForDate(
  date: string,
  requestedMonthId?: string,
  nowDate: Date = now(),
  timeZone: string = DEFAULT_TIME_ZONE,
): string {
  const currentMonthId = getMonthId(nowDate, timeZone);
  const prevMonthId = shiftMonthId(currentMonthId, -1);
  const dateMonthId = /^\d{4}-\d{2}-\d{2}$/.test(date) ? date.slice(0, 7) : '';
  if (
    dateMonthId === prevMonthId &&
    isWithinGraceWindow(nowDate, timeZone) &&
    (!requestedMonthId ||
      requestedMonthId === currentMonthId ||
      requestedMonthId === prevMonthId)
  ) {
    return prevMonthId;
  }
  return requestedMonthId ?? currentMonthId;
}

function isValidCalendarDate(date: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) return false;
  const [year, month, day] = date.split('-').map(Number);
  const parsed = new Date(Date.UTC(year, month - 1, day));
  return (
    parsed.getUTCFullYear() === year &&
    parsed.getUTCMonth() === month - 1 &&
    parsed.getUTCDate() === day
  );
}

export function validateTransactionTiming(
  monthId: string,
  date: string,
  nowDate: Date = now(),
  timeZone: string = DEFAULT_TIME_ZONE,
): void {
  if (!isValidCalendarDate(date)) {
    throw new Error('Selecciona una fecha válida.');
  }
  const currentMonthId = getMonthId(nowDate, timeZone);
  const prevMonthId = shiftMonthId(currentMonthId, -1);
  const allowedPreviousMonth =
    monthId === prevMonthId && isWithinGraceWindow(nowDate, timeZone);
  if (
    (monthId !== currentMonthId && !allowedPreviousMonth) ||
    date.slice(0, 7) !== monthId
  ) {
    throw new Error('La fecha debe pertenecer al mes actual abierto.');
  }
  if (date > toDateInputValue(nowDate, timeZone)) {
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
