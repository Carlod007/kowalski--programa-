import type { Month } from '@/types/month';
import type { ExpenseTransaction } from '@/types/transaction';
import type { Movement } from '@/types/movement';

/** Flujo neto del mes, no saldo gastable ni total acumulado. */
export function getMonthlySavingsNet(
  month: Pick<Month, 'ahorroContributedCents' | 'closed' | 'remainder'>,
  expenses: ExpenseTransaction[] | null,
  movements: Movement[] | null,
): number | null {
  if (!expenses || !movements) return null;
  const closing = month.closed ? month.remainder?.ocioToAhorroCents : 0;
  if (!Number.isInteger(month.ahorroContributedCents) || !Number.isInteger(closing)) return null;
  const withdrawals = expenses.filter((tx) => tx.category === 'ahorro');
  const transfers = movements.filter((m) => m.origin === 'ahorro');
  if ([...withdrawals, ...transfers].some((item) => !Number.isInteger(item.amountCents) || item.amountCents < 0)) return null;
  return month.ahorroContributedCents + closing!
    - withdrawals.reduce((sum, tx) => sum + tx.amountCents, 0)
    - transfers.reduce((sum, m) => sum + m.amountCents, 0);
}
