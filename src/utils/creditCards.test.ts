import { describe, expect, it } from "vitest";
import {
  getAvailableCreditCents,
  getCreditCardDisplayName,
  getCreditCardStatementStatus,
  getDueDateForClosing,
  getMostRecentClosingDate,
} from "./creditCards";

describe("tarjetas de crédito", () => {
  it("mantiene separada la línea disponible de la deuda", () => {
    expect(
      getAvailableCreditCents({
        creditLimitCents: 100_000,
        currentDebtCents: 35_000,
      }),
    ).toBe(65_000);
  });

  it("permite detectar cuando se superó la línea sin bloquear", () => {
    expect(
      getAvailableCreditCents({
        creditLimitCents: 100_000,
        currentDebtCents: 110_000,
      }),
    ).toBe(-10_000);
  });

  it("calcula corte y vencimiento respetando meses cortos", () => {
    expect(getMostRecentClosingDate(31, new Date(2026, 2, 10))).toBe(
      "2026-02-28",
    );
    expect(getDueDateForClosing("2026-01-31", 28)).toBe("2026-02-28");
    expect(getDueDateForClosing("2026-09-10", 25)).toBe("2026-09-25");
  });

  it("distingue atraso y mínimo cubierto", () => {
    const statement = {
      id: "s",
      closingDate: "2026-08-20",
      dueDate: "2026-09-05",
      statementBalanceCents: 50_000,
      minimumPaymentCents: 5_000,
      totalPaymentCents: 50_000,
      paidCents: 4_999,
    };
    expect(getCreditCardStatementStatus(statement, "2026-09-10")).toBe(
      "overdue",
    );
    expect(
      getCreditCardStatementStatus(
        { ...statement, paidCents: 5_000 },
        "2026-09-10",
      ),
    ).toBe("minimum-covered");
  });

  it("evita repetir entidad y nombre iguales", () => {
    expect(getCreditCardDisplayName({ issuer: "BCP", name: "BCP" })).toBe(
      "BCP",
    );
    expect(
      getCreditCardDisplayName({ issuer: "BCP", name: "Visa Oro" }),
    ).toBe("BCP · Visa Oro");
  });
});
