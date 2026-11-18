import { describe, expect, it } from "vitest";
import { formatCents, toIntCents } from "./currency";
import { calculateDistribution } from "./distribution";

describe("toIntCents y normalización entera de centavos", () => {
  it("convierte 0 y -0 en 0 positivo (nunca -0)", () => {
    expect(toIntCents(0)).toBe(0);
    expect(Object.is(toIntCents(0), -0)).toBe(false);

    const negZero = -0;
    expect(Object.is(negZero, -0)).toBe(true);
    expect(toIntCents(negZero)).toBe(0);
    expect(Object.is(toIntCents(negZero), -0)).toBe(false);

    const zeroBalance = { necesidad: 50_000, ocio: 0 };
    expect(Object.is(toIntCents(-zeroBalance.ocio), -0)).toBe(false);
    expect(toIntCents(-zeroBalance.ocio)).toBe(0);
  });

  it("conserva enteros como 4435 y redondea resultados de porcentajes a entero sin -0", () => {
    expect(toIntCents(4435)).toBe(4435);
    expect(Number.isInteger(toIntCents(4435))).toBe(true);

    const pctResult = toIntCents((14_783 * 30) / 100);
    expect(pctResult).toBe(4435);
    expect(Number.isInteger(pctResult)).toBe(true);

    const split = calculateDistribution(15_000, {
      necesidad: 100,
      ocio: 0,
      ahorro: 0,
    });
    expect(split).toEqual({ necesidad: 15_000, ocio: 0, ahorro: 0 });
    expect(Object.is(-split.ocio, -0)).toBe(true);
    expect(Object.is(toIntCents(-split.ocio), -0)).toBe(false);
  });

  it("formatCents sigue formateando soles peruanos", () => {
    expect(formatCents(4435)).toContain("44.35");
  });
});
