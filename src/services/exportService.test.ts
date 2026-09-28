import { describe, expect, it, vi } from 'vitest';
vi.mock('@/lib/firebase', () => ({ db: null }));
vi.mock('firebase/firestore', () => ({
  collection: (...parts: unknown[]) => parts.filter(Boolean).join('/'),
  documentId: () => '__id__',
  orderBy: vi.fn(),
  where: vi.fn(),
  query: (ref: string) => ref,
  getDocs: async (path: string) => path.endsWith('/months')
    ? { docs: [{ id: '2026-09' }] }
    : { docs: [
      { id: 'late', data: () => ({ type: 'expense', transactionDate: '2026-09-25', transactionTime: '18:00', localDate: new Date(2026, 8, 26, 18, 0).toISOString(), serverDate: null, category: 'ocio', subcategory: 'Taxi tarde', amountCents: 2000, paymentMethod: 'Yape' }) },
      { id: 'early', data: () => ({ type: 'expense', transactionDate: '2026-09-25', transactionTime: '09:00', localDate: new Date(2026, 8, 26, 20, 0).toISOString(), serverDate: null, category: 'ocio', subcategory: 'Taxi temprano', amountCents: 1000, paymentMethod: 'Yape' }) },
      { id: 'old', data: () => ({ type: 'income', transactionDate: '2026-09-01', localDate: new Date(2026, 8, 2, 17, 0).toISOString(), serverDate: null, source: 'P', amountCents: 10000 }) },
      { id: 'same', data: () => ({ type: 'income', transactionDate: '2026-09-26', localDate: new Date(2026, 8, 26, 17, 0).toISOString(), serverDate: null, source: 'Hoy', amountCents: 5000 }) },
    ] },
}));
import { buildHistoryCsv } from './exportService';
describe('exportación cronológica', () => {
  it('exporta un solo momento, ignora la hora legada y ordena por creación', async () => {
    const csv = await buildHistoryCsv('u', '2026-09', '2026-09');
    expect(csv).toContain('Fecha de operación (si distinta),Fecha de registro (local),Hora de registro (local, 24 h)');
    expect(csv).toContain('2026-09-25,2026-09-26,18:00');
    expect(csv).toContain('2026-09-25,2026-09-26,20:00');
    expect(csv.indexOf('Taxi tarde')).toBeLessThan(csv.indexOf('Taxi temprano'));
    expect(csv).toContain('2026-09-01,2026-09-02,17:00');
    expect(csv).toContain(',,2026-09-26,17:00,Hoy,,50.00');
    expect(csv).not.toContain('Hora real');
    expect(csv).not.toContain('09:00');
    expect(csv).not.toMatch(/\b(?:AM|PM)\b/i);
    expect(csv).toContain('Taxi temprano,,,Yape,,10.00');
  });
});
