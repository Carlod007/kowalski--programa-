import { describe, expect, it } from 'vitest';
import { getMonthlySavingsNet } from './monthlySavings';
import type { ExpenseTransaction } from '@/types/transaction';
import type { Movement } from '@/types/movement';

const expense = (amountCents: number, extra = {}): ExpenseTransaction => ({
  type: 'expense', category: 'ahorro', subcategory: 'Meta', paymentMethod: 'Yape',
  amountCents, transactionDate: '2026-09-20', localDate: '', serverDate: null, ...extra,
});
const out = { origin: 'ahorro', destination: 'ocio', amountCents: 1000 } as Movement;
describe('ahorro neto mensual', () => {
  it('resta retiros, compras, pagos de deuda y transferencias sin incluir otro mes', () => {
    expect(getMonthlySavingsNet({ ahorroContributedCents: 20000, closed: false }, [
      expense(2000, { goalId: 'fondo' }),
      expense(3000, { goalId: 'compra' }),
      expense(4000, { loanPaymentId: 'pago' }),
      expense(5000, { category: 'ocio', fundedByLoanId: 'prestamo' }),
      expense(7000, { category: 'necesidad', creditCardId: 'tarjeta' }),
    ], [out])).toBe(10000);
  });
  it('permite netos negativos al usar ahorro acumulado', () => {
    expect(getMonthlySavingsNet({ ahorroContributedCents: 1000, closed: false }, [expense(5000)], [])).toBe(-4000);
  });
  it('incluye aportes directos ya contabilizados una sola vez y el cierre del mismo mes', () => {
    expect(getMonthlySavingsNet({ ahorroContributedCents: 8000, closed: true, remainder: { ocioToAhorroCents: 2000 } }, [], [])).toBe(10000);
  });
  it('muestra datos incompletos como no determinables', () => {
    expect(getMonthlySavingsNet({ ahorroContributedCents: 1000, closed: true }, [], [])).toBeNull();
    expect(getMonthlySavingsNet({ ahorroContributedCents: 1000, closed: false }, null, [])).toBeNull();
    expect(getMonthlySavingsNet({ ahorroContributedCents: 1000, closed: false }, [], null)).toBeNull();
  });
});
