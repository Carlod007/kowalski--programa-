import { describe, expect, it } from "vitest";
import { getMonthRemainders } from "./monthRemainders";

describe("cierre mensual: neteo de déficits propios y separación de préstamos", () => {
  // Base común de los 4 escenarios requeridos:
  // Ingreso 1000 con 50/30/20 -> Necesidad 500, Ocio 300, Ahorro 200.
  const baseCaps = { necesidad: 500, ocio: 300 };

  it("escenario 1: Nec gastado 600, Ocio 0 -> ocioToAhorro 200, necToNext 0, netDeficit 0", () => {
    const result = getMonthRemainders({
      capsCents: baseCaps,
      spentCents: { necesidad: 600, ocio: 0 },
    });

    expect(result.ocioToAhorroCents).toBe(200);
    expect(result.necesidadToNextMonthCents).toBe(0);
    expect(result.netDeficitCents).toBe(0);
    expect(result.owned).toEqual({ necesidad: 0, ocio: 200 });
    expect(result.borrowed).toEqual({ necesidad: 0, ocio: 0 });
  });

  it("escenario 2: Nec gastado 700, Ocio 200 -> ocioToAhorro 0, necToNext 0, netDeficit 100", () => {
    const result = getMonthRemainders({
      capsCents: baseCaps,
      spentCents: { necesidad: 700, ocio: 200 },
    });

    expect(result.ocioToAhorroCents).toBe(0);
    expect(result.necesidadToNextMonthCents).toBe(0);
    expect(result.netDeficitCents).toBe(100);
    expect(result.owned).toEqual({ necesidad: 0, ocio: 0 });
    expect(result.borrowed).toEqual({ necesidad: 0, ocio: 0 });
  });

  it("escenario 3: Nec gastado 300, Ocio 400 -> necToNext 100, ocioToAhorro 0, netDeficit 0", () => {
    const result = getMonthRemainders({
      capsCents: baseCaps,
      spentCents: { necesidad: 300, ocio: 400 },
    });

    expect(result.necesidadToNextMonthCents).toBe(100);
    expect(result.ocioToAhorroCents).toBe(0);
    expect(result.netDeficitCents).toBe(0);
    expect(result.owned).toEqual({ necesidad: 100, ocio: 0 });
    expect(result.borrowed).toEqual({ necesidad: 0, ocio: 0 });
  });

  it("escenario 4: Nec gastado 400, Ocio 100 -> necToNext 100, ocioToAhorro 200, netDeficit 0", () => {
    const result = getMonthRemainders({
      capsCents: baseCaps,
      spentCents: { necesidad: 400, ocio: 100 },
    });

    expect(result.necesidadToNextMonthCents).toBe(100);
    expect(result.ocioToAhorroCents).toBe(200);
    expect(result.netDeficitCents).toBe(0);
    expect(result.owned).toEqual({ necesidad: 100, ocio: 200 });
    expect(result.borrowed).toEqual({ necesidad: 0, ocio: 0 });
  });

  it("separa el excedente propio del dinero prestado sin cambios respecto a hoy", () => {
    const result = getMonthRemainders({
      capsCents: { necesidad: 100_000, ocio: 80_000 },
      spentCents: { necesidad: 60_000, ocio: 30_000 },
      borrowedCapsCents: { necesidad: 20_000, ocio: 40_000 },
      loanFundedSpentCents: { necesidad: 10_000, ocio: 15_000 },
    });

    expect(result).toEqual({
      owned: { necesidad: 30_000, ocio: 25_000 },
      borrowed: { necesidad: 10_000, ocio: 25_000 },
      necesidadToNextMonthCents: 30_000,
      ocioToAhorroCents: 25_000,
      netDeficitCents: 0,
    });
  });

  it("mantiene el comportamiento anterior en meses sin campos de préstamo", () => {
    expect(
      getMonthRemainders({
        capsCents: { necesidad: 100_000, ocio: 80_000 },
        spentCents: { necesidad: 60_000, ocio: 30_000 },
      }),
    ).toEqual({
      owned: { necesidad: 40_000, ocio: 50_000 },
      borrowed: { necesidad: 0, ocio: 0 },
      necesidadToNextMonthCents: 40_000,
      ocioToAhorroCents: 50_000,
      netDeficitCents: 0,
    });
  });

  it("mantiene separado el saldo prestado aunque exista déficit propio", () => {
    const result = getMonthRemainders({
      capsCents: { necesidad: 70_000, ocio: 70_000 },
      spentCents: { necesidad: 80_000, ocio: 35_000 },
      borrowedCapsCents: { necesidad: 20_000, ocio: 40_000 },
      loanFundedSpentCents: { necesidad: 10_000, ocio: 15_000 },
    });

    // Propio: Nec cap 50_000 - spent 70_000 = -20_000; Ocio cap 30_000 - spent 20_000 = +10_000
    // Neteo propio: ocioToAhorro 0, necToNext 0, netDeficit 10_000.
    // Prestado intacto: Nec 10_000, Ocio 25_000.
    expect(result).toEqual({
      owned: { necesidad: 0, ocio: 0 },
      borrowed: { necesidad: 10_000, ocio: 25_000 },
      necesidadToNextMonthCents: 0,
      ocioToAhorroCents: 0,
      netDeficitCents: 10_000,
    });
  });
});
