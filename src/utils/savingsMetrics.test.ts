import { describe, it, expect } from "vitest";
import { Timestamp } from "firebase/firestore";
import {
  computeMonthSavingsMetrics,
  SAVINGS_DEFICIT_WARNING_COPY,
} from "./savingsMetrics";
import { getMonthlySavingsNet } from "./monthlySavings";
import type { Month } from "../types/month";
import type { Movement } from "../types/movement";
import type { ExpenseTransaction } from "../types/transaction";

function makeBaseMonth(overrides: Partial<Month> = {}): Month {
  return {
    totalIncomeCents: 100000,
    incomeCount: 1,
    distributedIncomeCount: 1,
    distribution: { necesidad: 50, ocio: 30, ahorro: 20 },
    capsCents: { necesidad: 50000, ocio: 30000 },
    spentCents: { necesidad: 20000, ocio: 10000 },
    ahorroContributedCents: 20000,
    closed: false,
    createdAt: Timestamp.now(),
    ...overrides,
  };
}

function makeMovement(
  origin: "necesidad" | "ocio" | "ahorro",
  destination: "necesidad" | "ocio" | "ahorro",
  amountCents: number,
): Movement {
  return {
    userId: "u1",
    monthId: "2026-04",
    origin,
    destination,
    amountCents,
    transactionDate: "2026-04-10",
    serverDate: Timestamp.now(),
  };
}

function makeAhorroExpense(
  amountCents: number,
  subcategory: string,
  extra: Partial<ExpenseTransaction> = {},
): ExpenseTransaction {
  return {
    type: "expense",
    amountCents,
    category: "ahorro",
    subcategory,
    paymentMethod: "transferencia",
    description: subcategory,
    transactionDate: "2026-04-12",
    localDate: "2026-04-12T10:00:00.000Z",
    serverDate: Timestamp.now(),
    ...extra,
  };
}

describe("computeMonthSavingsMetrics", () => {
  it("mantiene exactamente los mismos numeros en Dashboard y Movements tras ida y vuelta Ahorro -> Necesidad -> Ahorro", () => {
    const movements: Movement[] = [
      makeMovement("ahorro", "necesidad", 5000),
      makeMovement("necesidad", "ahorro", 5000),
    ];

    // Con F3 moveSurplus: salir de ahorro decrementa ahorroContributedCents (-5000) y volver lo incrementa (+5000) => 20000
    const monthF3 = makeBaseMonth({
      ahorroContributedCents: 20000,
    });
    const metricsF3 = computeMonthSavingsMetrics({
      month: monthF3,
      initialSplitAhorroCents: 20000,
      isInitialSplitDeterminable: true,
      movements,
      expenses: [],
    });

    expect(metricsF3.inflowsCents).toBe(25000); // 20000 reparto + 5000 transferencia hacia ahorro
    expect(metricsF3.outflowsCents).toBe(5000); // 5000 transferencia desde ahorro
    expect(metricsF3.netFlowCents).toBe(20000); // Neto intacto en S/ 200.00
    expect(metricsF3.untrackedCents).toBe(0);
    expect(metricsF3.effectiveSavingsRatePct).toBe("20.0");
    expect(getMonthlySavingsNet(monthF3, [], movements, 20000, true)).toBe(
      metricsF3.netFlowCents,
    );

    // Tambien en datos legacy donde moveSurplus no decrementaba ahorroContributedCents al salir de ahorro (quedaba en 25000)
    const monthLegacy = makeBaseMonth({
      ahorroContributedCents: 25000,
    });
    const metricsLegacy = computeMonthSavingsMetrics({
      month: monthLegacy,
      initialSplitAhorroCents: 20000,
      isInitialSplitDeterminable: true,
      movements,
      expenses: [],
    });
    expect(metricsLegacy.netFlowCents).toBe(20000);
    expect(metricsLegacy.untrackedCents).toBe(0);
    expect(getMonthlySavingsNet(monthLegacy, [], movements, 20000, true)).toBe(
      metricsLegacy.netFlowCents,
    );
  });

  it("incluye ocioToAhorroCents en las entradas y flujo neto cuando el mes esta cerrado", () => {
    const closedMonth = makeBaseMonth({
      closed: true,
      remainder: {
        ocioToAhorroCents: 8000,
        necesidadToNextMonthCents: 30000,
        netDeficitCents: 0,
        closedAt: Timestamp.now(),
      },
    });

    const metrics = computeMonthSavingsMetrics({
      month: closedMonth,
      initialSplitAhorroCents: 20000,
      isInitialSplitDeterminable: true,
      movements: [],
      expenses: [],
    });

    expect(metrics.closingOcioToAhorroCents).toBe(8000);
    expect(metrics.inflowsCents).toBe(28000);
    expect(metrics.outflowsCents).toBe(0);
    expect(metrics.netFlowCents).toBe(28000);
    expect(metrics.effectiveSavingsRatePct).toBe("28.0");
  });

  it("calcula correctamente un mes con porcentajes mixtos y egresos de Ahorro (metas, fondos, deudas)", () => {
    // Ingreso 1: S/ 1,000 al 50/30/20 -> Ahorro S/ 200 (20000)
    // Ingreso 2: S/ 1,000 al 60/25/15 -> Ahorro S/ 150 (15000)
    // Aporte directo: S/ 100 (10000)
    const mixedMonth = makeBaseMonth({
      totalIncomeCents: 200000,
      directSavingsCents: 10000,
      incomeCount: 3,
      distributedIncomeCount: 2,
      distribution: { necesidad: 60, ocio: 25, ahorro: 15 },
      capsCents: { necesidad: 110000, ocio: 55000 },
      spentCents: { necesidad: 50000, ocio: 20000 },
      ahorroContributedCents: 45000,
    });

    const expenses: ExpenseTransaction[] = [
      makeAhorroExpense(5000, "Meta: Laptop", { goalId: "g1" }),
      makeAhorroExpense(3000, "Retiro de emergencia", { goalId: "g2" }),
      makeAhorroExpense(4000, "Pago préstamo", { loanPaymentId: "l1" }),
    ];

    const metrics = computeMonthSavingsMetrics({
      month: mixedMonth,
      initialSplitAhorroCents: 35000,
      isInitialSplitDeterminable: true,
      movements: [],
      expenses,
    });

    expect(metrics.inflowsCents).toBe(45000); // 35000 reparto real + 10000 directo
    expect(metrics.ahorroExpensesCents).toBe(12000);
    expect(metrics.outflowsCents).toBe(12000);
    expect(metrics.netFlowCents).toBe(33000);
    // Tasa efectiva excluye aporte directo: (33000 - 10000) / 200000 = 23000 / 200000 = 11.5%
    expect(metrics.effectiveSavingsRatePct).toBe("11.5");
  });

  it("activa el aviso ambar cuando hay ahorro neto positivo pero un sobre tiene deficit pendiente", () => {
    const deficitMonth = makeBaseMonth({
      capsCents: { necesidad: 50000, ocio: 30000 },
      spentCents: { necesidad: 65000, ocio: 10000 }, // Necesidad en -15000
    });

    const metrics = computeMonthSavingsMetrics({
      month: deficitMonth,
      initialSplitAhorroCents: 20000,
      isInitialSplitDeterminable: true,
      movements: [],
      expenses: [],
    });

    expect(metrics.netFlowCents).toBe(20000);
    expect(metrics.hasEnvelopeDeficit).toBe(true);
    expect(metrics.envelopeDeficitWarning).toBe(SAVINGS_DEFICIT_WARNING_COPY);
  });
});
