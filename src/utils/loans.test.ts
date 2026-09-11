import { describe, expect, it } from "vitest";
import {
  addMonthsToDate,
  allocateLoanPayment,
  buildCustomLoanInstallments,
  canCancelUnusedLoan,
  generateFixedAmountInstallments,
  generateLoanInstallments,
  getLoanInstallmentStatus,
  getBorrowedAvailableByCategory,
  reverseLoanPayment,
  reassignBorrowedBalance,
} from "./loans";

describe("préstamos", () => {
  it("mantiene el fin de mes al generar vencimientos", () => {
    expect(addMonthsToDate("2026-01-31", 1)).toBe("2026-02-28");
    expect(addMonthsToDate("2028-01-31", 1)).toBe("2028-02-29");
  });

  it("pone el residuo de centavos en la última cuota", () => {
    const installments = generateLoanInstallments(10_000, 3, "2026-10-15");
    expect(installments.map((item) => item.amountCents)).toEqual([
      3333, 3333, 3334,
    ]);
    expect(installments.map((item) => item.dueDate)).toEqual([
      "2026-10-15",
      "2026-11-15",
      "2026-12-15",
    ]);
  });

  it("genera cuotas del monto fijo conocido", () => {
    const installments = generateFixedAmountInstallments(
      9_639,
      12,
      "2026-10-02",
    );
    expect(installments).toHaveLength(12);
    expect(installments.every((item) => item.amountCents === 9_639)).toBe(true);
    expect(
      installments.reduce((sum, item) => sum + item.amountCents, 0),
    ).toBe(115_668);
  });

  it("ordena y numera un calendario manual", () => {
    expect(
      buildCustomLoanInstallments([
        { dueDate: "2026-12-02", amountCents: 12_000 },
        { dueDate: "2026-10-02", amountCents: 10_000 },
        { dueDate: "2026-11-02", amountCents: 11_000 },
      ]).map(({ number, dueDate, amountCents }) => ({
        number,
        dueDate,
        amountCents,
      })),
    ).toEqual([
      { number: 1, dueDate: "2026-10-02", amountCents: 10_000 },
      { number: 2, dueDate: "2026-11-02", amountCents: 11_000 },
      { number: 3, dueDate: "2026-12-02", amountCents: 12_000 },
    ]);
  });

  it("aplica pagos parciales y adelantados desde la cuota más antigua", () => {
    const installments = generateLoanInstallments(30_000, 3, "2026-10-10");
    const result = allocateLoanPayment(installments, 15_000);
    expect(result.installments.map((item) => item.paidCents)).toEqual([
      10_000, 5_000, 0,
    ]);
    expect(result.allocations).toEqual([
      { installmentId: "installment-1", amountCents: 10_000 },
      { installmentId: "installment-2", amountCents: 5_000 },
    ]);
  });

  it("revierte exactamente las cuotas afectadas", () => {
    const installments = generateLoanInstallments(30_000, 3, "2026-10-10");
    const paid = allocateLoanPayment(installments, 15_000);
    expect(reverseLoanPayment(paid.installments, paid.allocations)).toEqual(
      installments,
    );
  });

  it("distingue cuota parcial y vencida", () => {
    expect(
      getLoanInstallmentStatus(
        {
          id: "a",
          number: 1,
          dueDate: "2026-09-01",
          amountCents: 10_000,
          paidCents: 3_000,
        },
        "2026-09-10",
      ),
    ).toBe("overdue");
  });

  it("mantiene compatibilidad con préstamos sin saldo por categoría", () => {
    expect(
      getBorrowedAvailableByCategory({
        userId: "u",
        amountReceivedCents: 50_000,
        totalToRepayCents: 55_000,
        receivedDate: "2026-09-10",
        receivedMonthId: "2026-09",
        destinationCategory: "ocio",
        borrowedAvailableCents: 30_000,
        paidCents: 0,
        installments: [],
        receiptTransactionId: "tx",
        createdAt: null,
        updatedAt: null,
      }),
    ).toEqual({ necesidad: 0, ocio: 30_000 });
  });

  it("reasigna solo el saldo prestado y conserva el total", () => {
    expect(
      reassignBorrowedBalance(
        { necesidad: 50_000, ocio: 10_000 },
        "necesidad",
        "ocio",
        15_000,
      ),
    ).toEqual({ necesidad: 35_000, ocio: 25_000 });
  });

  it("permite cancelar tras reasignar si todo el dinero sigue disponible", () => {
    expect(
      canCancelUnusedLoan({
        userId: "u",
        amountReceivedCents: 90_000,
        totalToRepayCents: 115_668,
        receivedDate: "2026-09-10",
        receivedMonthId: "2026-09",
        destinationCategory: "necesidad",
        borrowedAvailableCents: 90_000,
        borrowedAvailableByCategory: { necesidad: 90_000, ocio: 0 },
        paidCents: 0,
        fundMovementCount: 2,
        installments: [],
        receiptTransactionId: "tx",
        createdAt: null,
        updatedAt: null,
      }),
    ).toBe(true);
  });

  it("impide cancelar si hubo pagos o queda dinero prestado usado", () => {
    const loan = {
      userId: "u",
      amountReceivedCents: 90_000,
      totalToRepayCents: 115_668,
      receivedDate: "2026-09-10",
      receivedMonthId: "2026-09",
      destinationCategory: "necesidad" as const,
      borrowedAvailableCents: 90_000,
      paidCents: 0,
      installments: [],
      receiptTransactionId: "tx",
      createdAt: null,
      updatedAt: null,
    };

    expect(canCancelUnusedLoan({ ...loan, paidCents: 1 })).toBe(false);
    expect(
      canCancelUnusedLoan({ ...loan, borrowedAvailableCents: 89_999 }),
    ).toBe(false);
  });
});
