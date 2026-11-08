import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { getPendingMonthClosings, markMonthClosingSeen, rememberMonthClosing, subscribeMonthClosingNotices } from './monthClosingNotices';

describe('avisos locales de cierre por usuario y mes', () => {
  let values: Map<string, string>;
  beforeEach(() => {
    values = new Map();
    vi.stubGlobal('window', new EventTarget());
    vi.stubGlobal('localStorage', {
      get length() { return values.size; },
      key: (index: number) => [...values.keys()][index] ?? null,
      getItem: (key: string) => values.get(key) ?? null,
      setItem: (key: string, value: string) => values.set(key, value),
    });
  });
  afterEach(() => vi.unstubAllGlobals());

  it('una comprobación sin cierre no crea pendientes', () => {
    rememberMonthClosing('u', null);
    expect(values.size).toBe(0);
  });
  it('mantiene pendientes únicos y ordenados, separados por usuario', () => {
    rememberMonthClosing('u', '2026-09');
    rememberMonthClosing('u', '2026-08');
    rememberMonthClosing('u', '2026-09');
    rememberMonthClosing('other', '2026-07');
    expect(getPendingMonthClosings('u')).toEqual(['2026-08', '2026-09']);
    expect(getPendingMonthClosings('other')).toEqual(['2026-07']);
  });
  it('un resumen visto desde cualquier pantalla no vuelve a quedar pendiente', () => {
    markMonthClosingSeen('u', '2026-09');
    rememberMonthClosing('u', '2026-09');
    expect(getPendingMonthClosings('u')).toEqual([]);
    expect([...values.values()]).toEqual(['seen']);
  });
  it('recupera el pendiente guardado por una sesión anterior', () => {
    values.set('kowalski:month-closing:v1:u:2026-09', 'pending');
    expect(getPendingMonthClosings('u')).toEqual(['2026-09']);
    markMonthClosingSeen('u', '2026-09');
    expect(getPendingMonthClosings('u')).toEqual([]);
  });
  it('no mezcla usuarios con separadores en sus identificadores ni acepta claves inválidas', () => {
    rememberMonthClosing('u:other', '2026-09');
    values.set('kowalski:month-closing:v1:u:2026-99', 'pending');
    values.set('kowalski:month-closing:v1:u:bad', 'pending');
    expect(getPendingMonthClosings('u')).toEqual([]);
    expect(getPendingMonthClosings('u:other')).toEqual(['2026-09']);
  });
  it('avisa al Dashboard cuando otra pantalla detecta un cierre y permite desuscribirse', () => {
    const listener = vi.fn();
    const unsubscribe = subscribeMonthClosingNotices(listener);
    rememberMonthClosing('u', '2026-09');
    expect(listener).toHaveBeenCalledOnce();
    unsubscribe();
    markMonthClosingSeen('u', '2026-09');
    expect(listener).toHaveBeenCalledOnce();
  });
  it('el almacenamiento bloqueado no interrumpe la operación y conserva el aviso en esta sesión', () => {
    vi.stubGlobal('localStorage', {
      get length() { throw new Error('blocked'); },
      getItem: () => { throw new Error('blocked'); },
      setItem: () => { throw new Error('blocked'); },
    });
    expect(() => rememberMonthClosing('blocked-user', '2026-09')).not.toThrow();
    expect(getPendingMonthClosings('blocked-user')).toEqual(['2026-09']);
    markMonthClosingSeen('blocked-user', '2026-09');
    expect(getPendingMonthClosings('blocked-user')).toEqual([]);
  });
});
