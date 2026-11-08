import { describe, expect, it } from 'vitest';
import { Timestamp } from 'firebase/firestore';
import {
  compareRecordedTiming,
  getGraceDeadlineDate,
  getRecordedDate,
  isWithinGraceWindow,
  resolveTargetMonthIdForDate,
  validateTransactionTiming,
} from './transactionTiming';

const now = new Date(2026, 8, 26, 14, 30);
describe('fecha declarada y momento de registro', () => {
  it('acepta ayer y hoy dentro del mes actual', () => {
    expect(() => validateTransactionTiming('2026-09', '2026-09-25', now)).not.toThrow();
    expect(() => validateTransactionTiming('2026-09', '2026-09-26', now)).not.toThrow();
  });
  it.each([
    ['2026-09', '2026-08-31'],
    ['2026-08', '2026-08-31'],
    ['2026-09', '2026-09-27'],
    ['2026-09', '2026-09-31'],
    ['2026-09', ''],
  ])('rechaza fecha fuera de alcance: %s %s', (month, date) => {
    expect(() => validateTransactionTiming(month, date, now)).toThrow();
  });
  it('acepta un día del mes anterior solo durante los días 1 a 3', () => {
    const day2 = new Date(2026, 10, 2, 14, 30);
    expect(() => validateTransactionTiming('2026-10', '2026-10-30', day2)).not.toThrow();
    expect(isWithinGraceWindow(day2)).toBe(true);
    expect(getGraceDeadlineDate('2026-10')).toBe('2026-11-03');
    expect(resolveTargetMonthIdForDate('2026-10-30', '2026-11', day2)).toBe('2026-10');
    expect(resolveTargetMonthIdForDate('2026-11-01', '2026-11', day2)).toBe('2026-11');

    const day4 = new Date(2026, 10, 4, 14, 30);
    expect(isWithinGraceWindow(day4)).toBe(false);
    expect(() => validateTransactionTiming('2026-10', '2026-10-30', day4)).toThrow();
    expect(resolveTargetMonthIdForDate('2026-10-30', '2026-11', day4)).toBe('2026-11');
  });
  it('ordena por creación e ignora la hora declarada legada', () => {
    const base = { type: 'expense' as const, amountCents: 100, transactionDate: '2026-09-25', serverDate: null };
    const early = { ...base, transactionTime: '09:00', localDate: '2026-09-26T20:00:00Z' };
    const late = { ...base, transactionTime: '18:00', localDate: '2026-09-26T18:00:00Z' };
    expect([early, late].sort(compareRecordedTiming)).toEqual([late, early]);
  });
  it('conserva el registro del servidor y usa el local si aún no hay sincronización', () => {
    const localDate = '2026-09-26T18:00:00Z';
    const serverDate = Timestamp.fromDate(new Date('2026-09-26T19:00:00Z'));
    expect(getRecordedDate({ localDate, serverDate })?.toISOString()).toBe('2026-09-26T19:00:00.000Z');
    expect(getRecordedDate({ localDate, serverDate: null })?.toISOString()).toBe('2026-09-26T18:00:00.000Z');
    expect(getRecordedDate({ localDate: '', serverDate: null })).toBeNull();
  });
});
