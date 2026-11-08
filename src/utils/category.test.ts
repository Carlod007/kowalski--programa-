import { describe, it, expect } from "vitest";
import { getCategoryStatus, getCategoryDisplayBalance } from "./category";
import type { Month } from "../types/month";
import { Timestamp } from "firebase/firestore";

function makeBaseMonth(overrides: Partial<Month> = {}): Month {
  return {
    totalIncomeCents: 100000,
    incomeCount: 1,
    distribution: { necesidad: 50, ocio: 30, ahorro: 20 },
    capsCents: { necesidad: 50000, ocio: 30000 },
    spentCents: { necesidad: 40000, ocio: 10000 },
    ahorroContributedCents: 20000,
    closed: false,
    createdAt: Timestamp.now(),
    ...overrides,
  };
}

describe("getCategoryStatus", () => {
  it("calcula lo disponible como tope menos gastado", () => {
    const status = getCategoryStatus(59000, 10000);
    expect(status.disponible).toBe(49000);
    expect(status.isEmpty).toBe(false);
    expect(status.overCap).toBe(false);
  });

  it("marca como vacia una categoria sin tope ni gasto (0, 0)", () => {
    // Sin ingresos ni gastos del mes: no es "gastaste todo", es "aun nada".
    const status = getCategoryStatus(0, 0);
    expect(status.isEmpty).toBe(true);
    expect(status.disponible).toBe(0);
    expect(status.overCap).toBe(false);
    expect(status.barWidth).toBe(0);
  });

  it("muestra negativo y overCap cuando hay gasto sin tope (0, 25000)", () => {
    const status = getCategoryStatus(0, 25000);
    expect(status.isEmpty).toBe(false);
    expect(status.disponible).toBe(-25000);
    expect(status.overCap).toBe(true);
    expect(status.isLow).toBe(true);
    expect(status.barWidth).toBe(100);
  });

  it("detecta cuando se gasto de mas", () => {
    const status = getCategoryStatus(50000, 65000);
    expect(status.overCap).toBe(true);
    expect(status.disponible).toBe(-15000);
  });

  it("no deja que la barra pase de 100 aunque se exceda el tope", () => {
    expect(getCategoryStatus(50000, 65000).barWidth).toBe(100);
  });

  it("avisa cuando queda 15% o menos del tope", () => {
    // Justo en el limite tambien debe avisar.
    expect(getCategoryStatus(100000, 85000).isLow).toBe(true);
    expect(getCategoryStatus(100000, 84999).isLow).toBe(false);
  });

  it("un tope intacto no se reporta como bajo", () => {
    const status = getCategoryStatus(100000, 0);
    expect(status.isLow).toBe(false);
    expect(status.barWidth).toBe(0);
  });

  it("un tope agotado exacto queda en 100 sin exceder", () => {
    const status = getCategoryStatus(50000, 50000);
    expect(status.disponible).toBe(0);
    expect(status.overCap).toBe(false);
    expect(status.barWidth).toBe(100);
  });
});

describe("getCategoryDisplayBalance", () => {
  it("devuelve etiqueta 'disponible' en mes abierto", () => {
    const month = makeBaseMonth();
    expect(getCategoryDisplayBalance("necesidad", month)).toEqual({
      amountCents: 10000,
      label: "disponible",
      isOverCapAtClose: false,
      netDeficitCents: 0,
    });
  });

  it("usa los valores persistidos de remainder en mes cerrado (formato F1+)", () => {
    const month = makeBaseMonth({
      closed: true,
      remainder: {
        ocioToAhorroCents: 20000,
        necesidadToNextMonthCents: 10000,
        netDeficitCents: 0,
        closedAt: Timestamp.now(),
      },
    });
    expect(getCategoryDisplayBalance("ocio", month)).toEqual({
      amountCents: 20000,
      label: "sobrante transferido a Ahorro",
      isOverCapAtClose: false,
      netDeficitCents: 0,
    });
    expect(getCategoryDisplayBalance("necesidad", month)).toEqual({
      amountCents: 10000,
      label: "sobrante heredado al mes siguiente",
      isOverCapAtClose: false,
      netDeficitCents: 0,
    });
  });

  it("calcula con getMonthRemainders en meses cerrados legacy sin necesidadToNextMonthCents", () => {
    const month = makeBaseMonth({
      closed: true,
      remainder: {
        ocioToAhorroCents: 20000,
        closedAt: Timestamp.now(),
      },
    });
    expect(getCategoryDisplayBalance("necesidad", month)).toEqual({
      amountCents: 10000,
      label: "sobrante heredado al mes siguiente",
      isOverCapAtClose: false,
      netDeficitCents: 0,
    });
  });

  it("muestra 'excedido al cierre' cuando el sobre termino en negativo al cerrar", () => {
    const month = makeBaseMonth({
      closed: true,
      capsCents: { necesidad: 50000, ocio: 30000 },
      spentCents: { necesidad: 65000, ocio: 40000 },
    });
    const nec = getCategoryDisplayBalance("necesidad", month);
    expect(nec.amountCents).toBe(-15000);
    expect(nec.label).toBe("excedido al cierre");
    expect(nec.isOverCapAtClose).toBe(true);
    expect(nec.netDeficitCents).toBe(25000);
  });
});
