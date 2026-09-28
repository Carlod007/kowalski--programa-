import { beforeEach, afterEach, describe, expect, it, vi } from 'vitest';
const mocks = vi.hoisted(() => ({
  docs: new Map<string, Record<string, unknown>>(),
  update: vi.fn(),
}));
vi.mock('@/lib/firebase', () => ({ db: 'db' }));
vi.mock('firebase/firestore', () => ({
  doc: (...parts: (string | { path: string })[]) => ({ path: parts.filter((p) => p !== 'db').map((p) => typeof p === 'string' ? p : p.path).join('/') }),
  collection: (...parts: (string | { path: string })[]) => ({ path: parts.filter((p) => p !== 'db').map((p) => typeof p === 'string' ? p : p.path).join('/') }),
  where: (field: string, _operator: string, value: string) => ({ field, value }),
  query: (ref: { path: string }, filter: { field: string; value: string }) => ({ ...ref, filter }),
  getDocs: async (ref: { path: string; filter?: { field: string; value: string } }) => ({ docs: [...mocks.docs.keys()]
    .filter((path) => path.startsWith(ref.path + '/') && path.slice(ref.path.length + 1).split('/').length === 1)
    .filter((path) => !ref.filter || mocks.docs.get(path)?.[ref.filter.field] === ref.filter.value)
    .map((path) => ({ id: path.split('/').at(-1), ref: { path } })) }),
  runTransaction: async (_db: unknown, callback: (t: unknown) => unknown) => callback({
    get: async (ref: { path: string }) => ({ exists: () => mocks.docs.has(ref.path), data: () => mocks.docs.get(ref.path) }),
    update: (ref: { path: string }, data: unknown) => mocks.update(ref.path, data),
  }),
}));
import { updateTransactionTiming } from './transactionTimingService';
const month = 'users/u/months/2026-09';
const txPath = month + '/transactions/t';
describe('corrección de fecha sin modificar dinero', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date(2026, 8, 26, 14, 30));
    mocks.docs.clear();
    mocks.update.mockClear();
    mocks.docs.set(month, { closed: false });
    mocks.docs.set(txPath, { type: 'expense', category: 'ocio', transactionDate: '2026-09-26', amountCents: 1000 });
  });
  afterEach(() => vi.useRealTimers());
  it('solo actualiza el día, conservando monto, saldo y registro original', async () => {
    await updateTransactionTiming('u', '2026-09', 't', '2026-09-25');
    expect(mocks.update.mock.calls).toEqual([[txPath, { transactionDate: '2026-09-25' }]]);
  });
  it('conserva transactionTime legado al corregir el día', async () => {
    mocks.docs.set(txPath, { ...mocks.docs.get(txPath), transactionTime: '12:00' });
    await updateTransactionTiming('u', '2026-09', 't', '2026-09-25');
    expect(mocks.update).toHaveBeenCalledWith(txPath, { transactionDate: '2026-09-25' });
  });
  it('no permite modificar un mes cerrado', async () => {
    mocks.docs.set(month, { closed: true });
    await expect(updateTransactionTiming('u', '2026-09', 't', '2026-09-25')).rejects.toThrow('cerrado');
    expect(mocks.update).not.toHaveBeenCalled();
  });
  it.each(['loanPaymentId', 'creditCardStatementId'])('protege vínculos inmutables: %s', async (field) => {
    mocks.docs.set(txPath, { ...mocks.docs.get(txPath), [field]: 'linked' });
    await expect(updateTransactionTiming('u', '2026-09', 't', '2026-09-25')).rejects.toThrow('módulo original');
    expect(mocks.update).not.toHaveBeenCalled();
  });
  it('no corrige la recepción de un préstamo', async () => {
    mocks.docs.set(txPath, { ...mocks.docs.get(txPath), type: 'loan', loanId: 'l' });
    await expect(updateTransactionTiming('u', '2026-09', 't', '2026-09-25')).rejects.toThrow('módulo original');
    expect(mocks.update).not.toHaveBeenCalled();
  });
  it.each([['2026-09-26', '2026-09-20'], ['2026-09-19', '2026-09-25']])('no cruza el corte en ninguna dirección', async (original, target) => {
    mocks.docs.set(txPath, { ...mocks.docs.get(txPath), transactionDate: original, creditCardId: 'c' });
    mocks.docs.set('users/u/creditCards/c', { lastStatementClosingDate: '2026-09-20' });
    await expect(updateTransactionTiming('u', '2026-09', 't', target)).rejects.toThrow('estado confirmado');
    expect(mocks.update).not.toHaveBeenCalled();
  });
  it('rechaza un gasto anterior a recibir el préstamo', async () => {
    mocks.docs.set(txPath, { ...mocks.docs.get(txPath), fundedByLoanId: 'l' });
    mocks.docs.set('users/u/loans/l', { receivedDate: '2026-09-25' });
    await expect(updateTransactionTiming('u', '2026-09', 't', '2026-09-24')).rejects.toThrow('recepción');
    expect(mocks.update).not.toHaveBeenCalled();
  });
  it('corrige un gasto prestado sin consumir de nuevo el fondo', async () => {
    mocks.docs.set(txPath, { ...mocks.docs.get(txPath), fundedByLoanId: 'l' });
    mocks.docs.set('users/u/loans/l', { receivedDate: '2026-09-20' });
    await updateTransactionTiming('u', '2026-09', 't', '2026-09-25');
    expect(mocks.update).toHaveBeenCalledTimes(1);
    expect(mocks.update.mock.calls[0][0]).toBe(txPath);
  });
  it('corrige la última compra de la meta sin cambiar su asignación ni los saldos', async () => {
    const goal = { id: 'g', kind: 'compra', name: 'Laptop', allocatedCents: 4000, purchaseCount: 2, lastPurchasedAt: '2026-09-26' };
    mocks.docs.set('users/u', { savingsTotalCents: 90000, savingsGoals: [goal] });
    mocks.docs.set(txPath, { ...mocks.docs.get(txPath), category: 'ahorro', goalId: 'g' });
    mocks.docs.set(month + '/transactions/other', { type: 'expense', category: 'ahorro', goalId: 'g', transactionDate: '2026-09-24' });
    await updateTransactionTiming('u', '2026-09', 't', '2026-09-23');
    expect(mocks.update.mock.calls).toEqual([
      ['users/u', { savingsGoals: [{ ...goal, lastPurchasedAt: '2026-09-24' }] }],
      [txPath, { transactionDate: '2026-09-23' }],
    ]);
  });
  it('conserva la fecha de una compra previa de otro mes', async () => {
    const goal = { id: 'g', kind: 'compra', name: 'Laptop', allocatedCents: 4000, purchaseCount: 2, lastPurchasedAt: '2026-09-26' };
    mocks.docs.set('users/u', { savingsTotalCents: 90000, savingsGoals: [goal] });
    mocks.docs.set(txPath, { ...mocks.docs.get(txPath), category: 'ahorro', goalId: 'g' });
    mocks.docs.set('users/u/months/2026-08', { closed: true });
    mocks.docs.set('users/u/months/2026-08/transactions/older', { type: 'expense', category: 'ahorro', goalId: 'g', transactionDate: '2026-08-29' });
    await updateTransactionTiming('u', '2026-09', 't', '2026-09-20');
    expect(mocks.update).toHaveBeenCalledWith('users/u', { savingsGoals: [{ ...goal, lastPurchasedAt: '2026-09-20' }] });
  });
  it('mantiene la última compra cuando otra compra ocurrió el mismo día', async () => {
    const goal = { id: 'g', kind: 'compra', name: 'Laptop', allocatedCents: 4000, purchaseCount: 2, lastPurchasedAt: '2026-09-26' };
    mocks.docs.set('users/u', { savingsGoals: [goal] });
    mocks.docs.set(txPath, { ...mocks.docs.get(txPath), category: 'ahorro', goalId: 'g' });
    mocks.docs.set(month + '/transactions/other', { type: 'expense', category: 'ahorro', goalId: 'g', transactionDate: '2026-09-26' });
    await updateTransactionTiming('u', '2026-09', 't', '2026-09-23');
    expect(mocks.update).toHaveBeenCalledTimes(1);
    expect(mocks.update).toHaveBeenCalledWith(txPath, { transactionDate: '2026-09-23' });
  });
  it('guardar el mismo día de una compra no modifica el perfil de la meta', async () => {
    mocks.docs.set(txPath, { ...mocks.docs.get(txPath), category: 'ahorro', goalId: 'g' });
    await updateTransactionTiming('u', '2026-09', 't', '2026-09-26');
    expect(mocks.update).toHaveBeenCalledTimes(1);
    expect(mocks.update.mock.calls[0][0]).toBe(txPath);
  });
});
