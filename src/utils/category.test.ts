import { describe, it, expect } from "vitest";
import { getCategoryStatus } from "./category";

describe("getCategoryStatus", () => {
  it("calcula lo disponible como tope menos gastado", () => {
    const status = getCategoryStatus(59000, 10000);
    expect(status.disponible).toBe(49000);
    expect(status.isEmpty).toBe(false);
    expect(status.overCap).toBe(false);
  });

  it("marca como vacia una categoria sin tope todavia", () => {
    // Sin ingresos del mes no hay tope: no es "gastaste todo", es "aun nada".
    const status = getCategoryStatus(0, 0);
    expect(status.isEmpty).toBe(true);
    expect(status.disponible).toBe(0);
    expect(status.barWidth).toBe(0);
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
