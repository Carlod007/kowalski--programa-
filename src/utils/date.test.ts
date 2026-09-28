import { describe, expect, it } from 'vitest';
import { formatDayMonth, formatTime24 } from './date';

describe('formato de fecha y hora del Historial', () => {
  it('muestra fechas cortas y horas locales de 24 horas', () => {
    expect(formatDayMonth('2026-09-28')).toBe('28/09');
    expect(formatTime24(new Date(2026, 8, 28, 0, 5))).toBe('00:05');
    expect(formatTime24(new Date(2026, 8, 28, 14, 32))).toBe('14:32');
    expect(formatTime24(new Date(2026, 8, 28, 23, 59))).toBe('23:59');
  });
});
