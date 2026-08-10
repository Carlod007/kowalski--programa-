import { describe, it, expect } from "vitest";
import {
  calculateDistribution,
  calculateMinimumNecesidadPercentage,
  calculateProportionalSplit,
} from "./distribution";
import type { Distribution } from "../types/transaction";

const PLAN: Distribution = { necesidad: 18, ocio: 47, ahorro: 35 };

function total(d: Distribution): number {
  return d.necesidad + d.ocio + d.ahorro;
}

describe("calculateDistribution", () => {
  it("reparte segun los porcentajes del plan", () => {
    expect(calculateDistribution(100000, PLAN)).toEqual({
      necesidad: 18000,
      ocio: 47000,
      ahorro: 35000,
    });
  });

  it("nunca pierde ni inventa centavos, aunque el reparto no sea exacto", () => {
    // 333 centavos entre 18/47/35 no da entero en ninguna categoria.
    const split = calculateDistribution(333, PLAN);
    expect(total(split)).toBe(333);
  });

  it("mantiene la suma exacta para muchos montos distintos", () => {
    for (let cents = 1; cents <= 2000; cents++) {
      expect(total(calculateDistribution(cents, PLAN))).toBe(cents);
    }
  });

  it("deja el residuo del redondeo en ahorro, no en los topes", () => {
    // necesidad y ocio se truncan hacia abajo; ahorro absorbe la diferencia.
    const split = calculateDistribution(333, PLAN);
    expect(split.necesidad).toBe(Math.floor((333 * 18) / 100));
    expect(split.ocio).toBe(Math.floor((333 * 47) / 100));
    expect(split.ahorro).toBe(333 - split.necesidad - split.ocio);
  });

  it("con ingreso cero no reparte nada", () => {
    expect(calculateDistribution(0, PLAN)).toEqual({
      necesidad: 0,
      ocio: 0,
      ahorro: 0,
    });
  });

  it("manda todo a una sola categoria cuando el plan es 100/0/0", () => {
    const split = calculateDistribution(5000, {
      necesidad: 100,
      ocio: 0,
      ahorro: 0,
    });
    expect(split).toEqual({ necesidad: 5000, ocio: 0, ahorro: 0 });
  });
});

describe("calculateMinimumNecesidadPercentage", () => {
  it("calcula que porcentaje del ingreso fijo cubren las necesidades", () => {
    // 1800 de necesidades sobre 3000 de ingreso fijo = 60%.
    expect(calculateMinimumNecesidadPercentage(300000, 180000)).toBe(60);
  });

  it("redondea hacia arriba para no quedarse corto", () => {
    // 60.1% real: quedarse en 60 dejaria las necesidades sin cubrir.
    expect(calculateMinimumNecesidadPercentage(300000, 180300)).toBe(61);
  });

  it("devuelve 0 si no hay ingresos fijos declarados", () => {
    // Sin base con la cual comparar, no se inventa un minimo.
    expect(calculateMinimumNecesidadPercentage(0, 180000)).toBe(0);
  });

  it("puede pasar de 100 cuando las necesidades superan al ingreso", () => {
    // Es un deficit real: la app debe poder detectarlo, no disimularlo.
    expect(calculateMinimumNecesidadPercentage(100000, 150000)).toBe(150);
  });

  it("devuelve 0 si no hay necesidades declaradas", () => {
    expect(calculateMinimumNecesidadPercentage(300000, 0)).toBe(0);
  });
});

describe("calculateProportionalSplit", () => {
  it("mantiene las proporciones del reparto original al cambiar el monto", () => {
    const original: Distribution = { necesidad: 180, ocio: 470, ahorro: 350 };
    expect(calculateProportionalSplit(2000, 1000, original)).toEqual({
      necesidad: 360,
      ocio: 940,
      ahorro: 700,
    });
  });

  it("no pierde ni inventa centavos al reescalar", () => {
    const original: Distribution = { necesidad: 180, ocio: 470, ahorro: 350 };
    for (let cents = 1; cents <= 2000; cents++) {
      expect(total(calculateProportionalSplit(cents, 1000, original))).toBe(
        cents,
      );
    }
  });

  it("coincide con el reparto original si el monto no cambia", () => {
    // Editar un ingreso sin tocar el monto no debe mover ningun saldo.
    const original: Distribution = { necesidad: 180, ocio: 470, ahorro: 350 };
    expect(calculateProportionalSplit(1000, 1000, original)).toEqual(original);
  });

  it("manda todo a ahorro si el monto original era cero", () => {
    // Sin proporciones de referencia no se puede repartir: el residuo va a
    // ahorro, que es la categoria que absorbe.
    const original: Distribution = { necesidad: 0, ocio: 0, ahorro: 0 };
    expect(calculateProportionalSplit(500, 0, original)).toEqual({
      necesidad: 0,
      ocio: 0,
      ahorro: 500,
    });
  });

  it("respeta un reparto original que iba entero a ahorro", () => {
    // Es el caso de un aporte directo: no debe empezar a repartirse.
    const original: Distribution = { necesidad: 0, ocio: 0, ahorro: 1000 };
    expect(calculateProportionalSplit(1000, 1000, original)).toEqual(original);
  });
});
