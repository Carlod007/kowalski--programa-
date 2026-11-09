import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

type Reference = { path: string };
type Transaction = {
  get: (ref: Reference) => Promise<{ exists: () => boolean; data: () => Record<string, unknown> | undefined }>;
  update: (ref: Reference, data: unknown) => void;
  set: (ref: Reference, data: unknown) => void;
};
const mocks = vi.hoisted(() => ({ docs: new Map<string, Record<string, unknown>>(), update: vi.fn(), set: vi.fn(), run: vi.fn() }));
vi.mock('@/lib/firebase', () => ({ db: 'db' }));
vi.mock('firebase/firestore', () => {
  const reference = (...parts: (string | Reference)[]) => ({ path: parts.filter((part) => part !== 'db').map((part) => typeof part === 'string' ? part : part.path).join('/') });
  return { doc: reference, collection: reference, increment: (amount: number) => ({ increment: amount }), serverTimestamp: () => 'server', runTransaction: mocks.run };
});
import { checkAndCloseMonth } from './monthService';
import { checkAndRememberMonthClosing } from './monthClosingNoticeService';
import { getPendingMonthClosings } from '@/utils/monthClosingNotices';

describe('resultado real del cierre y consumo posterior al commit', () => {
  let transaction: Transaction;
  beforeEach(() => {
    vi.useFakeTimers();
    // F5: el día 2 es ventana de gracia; esta suite conserva el cierre de F4
    // usando el día 4, cuando la gracia ya venció.
    vi.setSystemTime(new Date(2026, 9, 4, 12));
    mocks.docs.clear(); mocks.update.mockClear(); mocks.set.mockClear(); mocks.run.mockReset();
    const values = new Map<string, string>();
    vi.stubGlobal('localStorage', { get length() { return values.size; }, key: (i: number) => [...values.keys()][i] ?? null,
      getItem: (key: string) => values.get(key) ?? null, setItem: (key: string, value: string) => values.set(key, value) });
    mocks.docs.set('users/u', { lastClosedMonth: '2026-09', distribution: { necesidad: 50, ocio: 30, ahorro: 20 }, savingsTotalCents: 1000 });
    mocks.docs.set('users/u/months/2026-09', { closed: false, incomeCount: 1,
      capsCents: { necesidad: 100000, ocio: 80000 }, spentCents: { necesidad: 60000, ocio: 30000 },
      borrowedCapsCents: { necesidad: 20000, ocio: 40000 }, loanFundedSpentCents: { necesidad: 10000, ocio: 15000 } });
    transaction = { get: async (ref) => ({ exists: () => mocks.docs.has(ref.path), data: () => mocks.docs.get(ref.path) }),
      update: (ref, data) => mocks.update(ref.path, data), set: (ref, data) => mocks.set(ref.path, data) };
    mocks.run.mockImplementation(async (_db, callback) => callback(transaction));
  });
  afterEach(() => { vi.useRealTimers(); vi.unstubAllGlobals(); });

  it('devuelve el mes realmente cerrado y conserva sus importes y traslados', async () => {
    expect(await checkAndCloseMonth('u')).toEqual({ closedMonthId: '2026-09' });
    expect(mocks.update).toHaveBeenCalledWith('users/u/months/2026-09', {
      closed: true,
      remainder: {
        ocioToAhorroCents: 25000,
        ocioToNextMonthCents: 0,
        necesidadToNextMonthCents: 30000,
        necesidadSweptToAhorroCents: 0,
        netDeficitCents: 0,
        borrowedNecesidadCents: 10000,
        borrowedOcioCents: 25000,
        deficitResolution: 'none',
        closedAt: 'server',
      },
    });
    expect(mocks.update).toHaveBeenCalledWith('users/u', {
      lastClosedMonth: '2026-10',
      pendingCloseMonthId: null,
      savingsTotalCents: { increment: 25000 },
      unseenClosedMonthId: '2026-09',
    });
    expect(mocks.set.mock.calls[0][1]).toMatchObject({
      capsCents: { necesidad: 40000, ocio: 25000 },
      borrowedCapsCents: { necesidad: 10000, ocio: 25000 },
      inheritedNecesidadCents: 30000,
    });
    expect(getPendingMonthClosings('u')).toEqual([]);
  });
  it.each(['initial', 'already-processed', 'missing-previous', 'closed-previous'])('devuelve null sin cierre nuevo: %s', async (state) => {
    const profile = mocks.docs.get('users/u')!;
    if (state === 'initial') profile.lastClosedMonth = null;
    if (state === 'already-processed') profile.lastClosedMonth = '2026-10';
    if (state === 'missing-previous') mocks.docs.delete('users/u/months/2026-09');
    if (state === 'closed-previous') mocks.docs.get('users/u/months/2026-09')!.closed = true;
    expect(await checkAndRememberMonthClosing('u')).toEqual({ closedMonthId: null });
    expect(getPendingMonthClosings('u')).toEqual([]);
  });
  it('no persiste el aviso hasta que la transacción confirme su éxito', async () => {
    let commit!: () => void;
    const committed = new Promise<void>((resolve) => { commit = resolve; });
    mocks.run.mockImplementation(async (_db, callback) => {
      const result = await callback(transaction);
      expect(getPendingMonthClosings('u')).toEqual([]);
      await committed;
      return result;
    });
    const request = checkAndRememberMonthClosing('u');
    expect(getPendingMonthClosings('u')).toEqual([]);
    commit();
    await request;
    expect(getPendingMonthClosings('u')).toEqual(['2026-09']);
  });
  it('un callback ejecutado pero con commit rechazado no genera aviso', async () => {
    mocks.run.mockImplementation(async (_db, callback) => { await callback(transaction); throw new Error('commit failed'); });
    await expect(checkAndRememberMonthClosing('u')).rejects.toThrow('commit failed');
    expect(getPendingMonthClosings('u')).toEqual([]);
  });
  it('comparte una comprobación simultánea del mismo usuario y permite volver a comprobar después', async () => {
    let commit!: () => void;
    const committed = new Promise<void>((resolve) => { commit = resolve; });
    mocks.run.mockImplementation(async (_db, callback) => { const result = await callback(transaction); await committed; return result; });
    const first = checkAndRememberMonthClosing('u');
    const second = checkAndRememberMonthClosing('u');
    expect(first).toBe(second);
    expect(mocks.run).toHaveBeenCalledOnce();
    commit();
    await Promise.all([first, second]);
    expect(getPendingMonthClosings('u')).toEqual(['2026-09']);
    mocks.docs.get('users/u')!.lastClosedMonth = '2026-10';
    await checkAndRememberMonthClosing('u');
    expect(mocks.run).toHaveBeenCalledTimes(2);
  });
  it('solo consume el resultado del último intento cuando Firestore reintenta', async () => {
    mocks.run.mockImplementation(async (_db, callback) => {
      expect(await callback(transaction)).toEqual({ closedMonthId: '2026-09' });
      expect(getPendingMonthClosings('u')).toEqual([]);
      mocks.docs.get('users/u')!.lastClosedMonth = '2026-10';
      return callback(transaction);
    });
    expect(await checkAndRememberMonthClosing('u')).toEqual({ closedMonthId: null });
    expect(getPendingMonthClosings('u')).toEqual([]);
  });
});
