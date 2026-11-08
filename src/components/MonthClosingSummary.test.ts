import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';
import type { Month } from '@/types/month';
vi.mock('@/lib/firebase', () => ({ db: 'db' }));
import { MonthClosingSummaryContent } from './MonthClosingSummary';

const month: Month = { totalIncomeCents: 100000, distribution: { necesidad: 50, ocio: 30, ahorro: 20 },
  capsCents: { necesidad: 100000, ocio: 80000 }, spentCents: { necesidad: 60000, ocio: 30000 },
  borrowedCapsCents: { necesidad: 20000, ocio: 40000 }, loanFundedSpentCents: { necesidad: 10000, ocio: 15000 },
  ahorroContributedCents: 20000, incomeCount: 1, closed: true, remainder: { ocioToAhorroCents: 25000 }, createdAt: null };
const render = (data: Month, monthId = '2026-09') => renderToStaticMarkup(createElement(MonthClosingSummaryContent, { monthId, month: data }));

describe('contenido compartido del resumen de cierre', () => {
  it('separa el saldo propio de Necesidad del prestado con el cálculo del cierre', () => {
    const html = render(month);
    expect(html).toContain('Necesidad propia no usada');
    expect(html).toContain('Necesidad prestada no usada');
    expect(html).toContain('300.00');
    expect(html).toContain('100.00');
    expect(html).toContain('250.00');
    expect(html).not.toContain('400.00');
  });
  it('un mes pasado abierto sigue siendo proyección', () => {
    const html = render({ ...month, closed: false, remainder: undefined }, '2020-01');
    expect(html).toContain('Así va');
    expect(html).toContain('Proyección');
    expect(html).toContain('se sumaría');
    expect(html).not.toContain('Así quedó');
    expect(html).toContain('250.00');
  });
  it('un mes cerrado utiliza etiquetas definitivas y el remanente registrado', () => {
    const html = render({ ...month, remainder: { ocioToAhorroCents: 12345 } });
    expect(html).toContain('Así quedó');
    expect(html).toContain('se sumó');
    expect(html).toContain('123.45');
    expect(html).not.toContain('se sumaría');
    expect(html).not.toContain('Proyección');
  });
  it('un cierre sin remainder muestra No disponible sin recalcular o inventar cero', () => {
    const html = render({ ...month, remainder: undefined });
    expect(html).toContain('No disponible');
    const ocioRow = html.match(/Ocio propio sobrante[\s\S]*?<\/div>/)?.[0];
    expect(ocioRow).toContain('No disponible');
    expect(ocioRow).not.toContain('250.00');
  });
  it('un remainder de cero es un dato válido, no un dato faltante', () => {
    const html = render({ ...month, remainder: { ocioToAhorroCents: 0 } });
    expect(html).not.toContain('No disponible');
    expect(html).toContain('0.00');
  });
  it('muestra el neteo de déficits y el déficit neto en modo proyección y cerrado', () => {
    const deficitMonth: Month = {
      totalIncomeCents: 100000,
      distribution: { necesidad: 50, ocio: 30, ahorro: 20 },
      capsCents: { necesidad: 50000, ocio: 30000 },
      spentCents: { necesidad: 70000, ocio: 20000 },
      ahorroContributedCents: 20000,
      incomeCount: 1,
      closed: false,
      createdAt: null,
    };
    const projectionHtml = render(deficitMonth, '2026-10');
    expect(projectionHtml).toContain('Déficit neto del mes');
    expect(projectionHtml).toContain('100.00');

    const closedHtml = render({
      ...deficitMonth,
      closed: true,
      remainder: {
        ocioToAhorroCents: 0,
        necesidadToNextMonthCents: 0,
        netDeficitCents: 10000,
      },
    }, '2026-10');
    expect(closedHtml).toContain('Déficit neto del mes');
    expect(closedHtml).toContain('100.00');
  });
});
