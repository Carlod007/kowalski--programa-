import { describe, expect, it } from "vitest";
import {
  getBorrowedEnvelopesCents,
  getTotalCreditCardsDebtCents,
} from "./dashboardChips";

describe("chips secundarios del Dashboard", () => {
  it("préstamo de S/ 500 sin gastar: devuelve 50_000 centavos en los sobres", () => {
    expect(
      getBorrowedEnvelopesCents({
        borrowedCapsCents: { necesidad: 50_000, ocio: 0 },
      }),
    ).toBe(50_000);
  });

  it("incluye dinero prestado arrastrado entre sobres de Necesidad y Ocio", () => {
    expect(
      getBorrowedEnvelopesCents({
        borrowedCapsCents: { necesidad: 35_000, ocio: 15_000 },
      }),
    ).toBe(50_000);
  });

  it("préstamo importado de saldo 300 (borrowedCapsCents en 0): no aparece como recibido", () => {
    expect(
      getBorrowedEnvelopesCents({
        borrowedCapsCents: { necesidad: 0, ocio: 0 },
      }),
    ).toBe(0);
    expect(getBorrowedEnvelopesCents(null)).toBe(0);
  });

  it("tarjetas con deuda de S/ 200 y S/ 150: suma 35_000 centavos (S/ 350)", () => {
    expect(
      getTotalCreditCardsDebtCents([
        { currentDebtCents: 20_000 },
        { currentDebtCents: 15_000 },
      ]),
    ).toBe(35_000);
  });
});
