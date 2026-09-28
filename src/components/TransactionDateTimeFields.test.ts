import { afterEach, describe, expect, it, vi } from 'vitest';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import TransactionDateTimeFields from './TransactionDateTimeFields';

describe('selector de día de una operación', () => {
  afterEach(() => vi.useRealTimers());

  it('oculta el selector por defecto y no ofrece una hora', () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date(2026, 8, 26, 14, 30));
    const html = renderToStaticMarkup(createElement(TransactionDateTimeFields, { date: '', onDateChange: () => undefined }));
    expect(html).toContain('Fecha: hoy');
    expect(html).toContain('Registrar un día pasado');
    expect(html).not.toContain('type="date"');
    expect(html).not.toContain('type="time"');
  });

  it('permite seleccionar solo un día pasado del mes', () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date(2026, 8, 26, 14, 30));
    const html = renderToStaticMarkup(createElement(TransactionDateTimeFields, { date: '2026-09-25', onDateChange: () => undefined }));
    expect(html).toContain('type="date"');
    expect(html).toContain('min="2026-09-01"');
    expect(html).toContain('max="2026-09-25"');
    expect(html).not.toContain('type="time"');
  });

  it('en el Historial muestra el selector para corregir el día', () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date(2026, 8, 26, 14, 30));
    const html = renderToStaticMarkup(createElement(TransactionDateTimeFields, { date: '2026-09-25', onDateChange: () => undefined, editing: true }));
    expect(html).toContain('Corregir fecha');
    expect(html).toContain('max="2026-09-26"');
    expect(html).not.toContain('type="time"');
  });
});
