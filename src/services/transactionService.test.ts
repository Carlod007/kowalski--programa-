import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  docs: new Map<string, Record<string, unknown>>(),
  set: vi.fn(),
  update: vi.fn(),
  delete: vi.fn(),
  autoId: 0,
}));

vi.mock("@/lib/firebase", () => ({ db: "db" }));
vi.mock("firebase/firestore", () => ({
  doc: (...parts: (string | { path: string })[]) => {
    const filtered = parts.filter((p) => p !== "db");
    if (
      filtered.length === 1 &&
      typeof filtered[0] === "object" &&
      "path" in filtered[0]
    ) {
      mocks.autoId += 1;
      return { path: `${filtered[0].path}/generated-${mocks.autoId}` };
    }
    return {
      path: filtered
        .map((p) => (typeof p === "string" ? p : p.path))
        .join("/"),
    };
  },
  collection: (...parts: (string | { path: string })[]) => ({
    path: parts
      .filter((p) => p !== "db")
      .map((p) => (typeof p === "string" ? p : p.path))
      .join("/"),
  }),
  increment: (n: number) => ({ __op: "increment", value: n }),
  deleteField: () => ({ __op: "deleteField" }),
  serverTimestamp: () => "SERVER_TIMESTAMP",
  runTransaction: async (_db: unknown, callback: (t: unknown) => unknown) =>
    callback({
      get: async (ref: { path: string }) => ({
        exists: () => mocks.docs.has(ref.path),
        data: () => mocks.docs.get(ref.path),
      }),
      set: (ref: { path: string }, data: unknown) =>
        mocks.set(ref.path, data),
      update: (ref: { path: string }, data: unknown) =>
        mocks.update(ref.path, data),
      delete: (ref: { path: string }) => mocks.delete(ref.path),
    }),
}));

import {
  deleteTransaction,
  purchaseGoalExpense,
  updateExpense,
  updateIncome,
  withdrawFromFund,
} from "./transactionService";
import { checkAndCloseMonth } from "./monthService";

const userPath = "users/u";
const monthPath = "users/u/months/2026-09";
const prevMonthPath = "users/u/months/2026-08";
const txPath = `${monthPath}/transactions/tx1`;

describe("integridad financiera F1 en servicios", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date(2026, 8, 15, 12, 0));
    mocks.docs.clear();
    mocks.set.mockClear();
    mocks.update.mockClear();
    mocks.delete.mockClear();
    mocks.autoId = 0;
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  describe("e) assertRevertible (deleteTransaction) y updateIncome", () => {
    it("bloquea borrar un ingreso si el gasto del mes ya consumió parte del tope propio", async () => {
      mocks.docs.set(userPath, {
        savingsTotalCents: 20_000,
        savingsGoals: [],
      });
      mocks.docs.set(monthPath, {
        closed: false,
        capsCents: { necesidad: 50_000, ocio: 30_000 },
        spentCents: { necesidad: 10_000, ocio: 0 },
        borrowedCapsCents: { necesidad: 0, ocio: 0 },
        loanFundedSpentCents: { necesidad: 0, ocio: 0 },
      });
      mocks.docs.set(txPath, {
        type: "income",
        amountCents: 100_000,
        distribution: { necesidad: 50_000, ocio: 30_000, ahorro: 20_000 },
      });

      await expect(
        deleteTransaction("u", "2026-09", "tx1"),
      ).rejects.toThrow("disponible propio de Necesidad");
      expect(mocks.delete).not.toHaveBeenCalled();
    });

    it("bloquea borrar un ingreso si su parte de Ahorro está asignada a metas e indica cuánto liberar", async () => {
      mocks.docs.set(userPath, {
        savingsTotalCents: 20_000,
        savingsGoals: [
          {
            id: "g1",
            name: "Fondo",
            kind: "fondo",
            targetCents: 50_000,
            allocatedCents: 15_000,
          },
        ],
      });
      mocks.docs.set(monthPath, {
        closed: false,
        capsCents: { necesidad: 50_000, ocio: 30_000 },
        spentCents: { necesidad: 0, ocio: 0 },
      });
      mocks.docs.set(txPath, {
        type: "income",
        amountCents: 100_000,
        distribution: { necesidad: 50_000, ocio: 30_000, ahorro: 20_000 },
      });

      // Sin asignar = 20_000 - 15_000 = 5_000; faltan liberar 15_000 (S/ 150.00)
      await expect(
        deleteTransaction("u", "2026-09", "tx1"),
      ).rejects.toThrow(/Libera S\/\s*150\.00 de tus metas primero/);
      expect(mocks.delete).not.toHaveBeenCalled();
    });

    it("bloquea reducir un ingreso si el disponible propio (ownedCap - ownedSpent) no cubre la reducción", async () => {
      mocks.docs.set(userPath, {
        savingsTotalCents: 20_000,
        savingsGoals: [],
      });
      mocks.docs.set(monthPath, {
        closed: false,
        capsCents: { necesidad: 50_000, ocio: 30_000 },
        spentCents: { necesidad: 0, ocio: 20_000 },
      });
      mocks.docs.set(txPath, {
        type: "income",
        amountCents: 100_000,
        source: "Sueldo",
        distribution: { necesidad: 50_000, ocio: 30_000, ahorro: 20_000 },
      });

      // Bajar de 1000 a 500 reduce Ocio en 150, pero disponible propio de Ocio es 300 - 200 = 100.
      await expect(
        updateIncome("u", "2026-09", "tx1", {
          amountCents: 50_000,
          source: "Sueldo",
        }),
      ).rejects.toThrow("disponible propio de Ocio");
      expect(mocks.update).not.toHaveBeenCalled();
    });

    it("bloquea reducir un ingreso si dejaría el ahorro sobreasignado a metas", async () => {
      mocks.docs.set(userPath, {
        savingsTotalCents: 20_000,
        savingsGoals: [
          {
            id: "g1",
            name: "Laptop",
            kind: "compra",
            targetCents: 20_000,
            allocatedCents: 15_000,
          },
        ],
      });
      mocks.docs.set(monthPath, {
        closed: false,
        capsCents: { necesidad: 50_000, ocio: 30_000 },
        spentCents: { necesidad: 0, ocio: 0 },
      });
      mocks.docs.set(txPath, {
        type: "income",
        amountCents: 100_000,
        source: "Sueldo",
        distribution: { necesidad: 50_000, ocio: 30_000, ahorro: 20_000 },
      });

      // Bajar a 50_000 reduce ahorro en 10_000; sin asignar es 5_000 -> pide liberar S/ 50.00
      await expect(
        updateIncome("u", "2026-09", "tx1", {
          amountCents: 50_000,
          source: "Sueldo",
        }),
      ).rejects.toThrow(/Libera S\/\s*50\.00 de tus metas primero/);
      expect(mocks.update).not.toHaveBeenCalled();
    });
  });

  describe("f) withdrawFromFund y purchaseGoalExpense contra savingsTotalCents", () => {
    it("withdrawFromFund bloquea retiro si supera savingsTotalCents en cuenta histórica sobreasignada", async () => {
      mocks.docs.set(userPath, {
        savingsTotalCents: 8_000,
        savingsGoals: [
          {
            id: "f1",
            name: "Emergencia",
            kind: "fondo",
            targetCents: 50_000,
            allocatedCents: 15_000,
          },
        ],
      });
      mocks.docs.set(monthPath, { closed: false });

      await expect(
        withdrawFromFund("u", "2026-09", {
          goalId: "f1",
          amountCents: 10_000,
          paymentMethod: "Transferencia",
          date: "2026-09-15",
        }),
      ).rejects.toThrow("ahorro total disponible");
      expect(mocks.set).not.toHaveBeenCalled();
      expect(mocks.update).not.toHaveBeenCalled();
    });

    it("purchaseGoalExpense bloquea compra si targetCents supera savingsTotalCents aunque allocatedCents cubra el objetivo", async () => {
      mocks.docs.set(userPath, {
        savingsTotalCents: 12_000,
        savingsGoals: [
          {
            id: "c1",
            name: "Monitor",
            kind: "compra",
            targetCents: 20_000,
            allocatedCents: 20_000,
          },
        ],
      });
      mocks.docs.set(monthPath, { closed: false });

      await expect(
        purchaseGoalExpense("u", "2026-09", {
          goalId: "c1",
          paymentMethod: "Tarjeta",
          date: "2026-09-15",
        }),
      ).rejects.toThrow("ahorro total disponible");
      expect(mocks.set).not.toHaveBeenCalled();
      expect(mocks.update).not.toHaveBeenCalled();
    });
  });

  describe("g) updateExpense en categoría ahorro", () => {
    it("rechaza cambiar el monto de un egreso de Ahorro (delta !== 0)", async () => {
      mocks.docs.set(monthPath, { closed: false });
      mocks.docs.set(txPath, {
        type: "expense",
        category: "ahorro",
        subcategory: "Emergencia",
        paymentMethod: "Efectivo",
        amountCents: 10_000,
        transactionDate: "2026-09-10",
      });

      await expect(
        updateExpense("u", "2026-09", "tx1", {
          amountCents: 12_000,
          subcategory: "Emergencia",
          paymentMethod: "Efectivo",
        }),
      ).rejects.toThrow("El monto de un egreso de Ahorro no se puede editar");
      expect(mocks.update).not.toHaveBeenCalled();
    });

    it("permite editar descripción o método de pago en egreso de Ahorro cuando delta === 0", async () => {
      mocks.docs.set(monthPath, { closed: false });
      mocks.docs.set(txPath, {
        type: "expense",
        category: "ahorro",
        subcategory: "Emergencia",
        paymentMethod: "Efectivo",
        amountCents: 10_000,
        transactionDate: "2026-09-10",
      });

      await updateExpense("u", "2026-09", "tx1", {
        amountCents: 10_000,
        subcategory: "Emergencia",
        paymentMethod: "Transferencia",
        description: "Nota actualizada",
      });

      expect(mocks.update).toHaveBeenCalledTimes(1);
      expect(mocks.update.mock.calls[0][0]).toBe(txPath);
    });
  });

  describe("c) checkAndCloseMonth con neteo e inheritedNecesidadCents", () => {
    it("registra remainder neteado con netDeficitCents y guarda inheritedNecesidadCents en el mes nuevo", async () => {
      mocks.docs.set(userPath, {
        distribution: { necesidad: 50, ocio: 30, ahorro: 20 },
        lastClosedMonth: "2026-08",
        savingsTotalCents: 20_000,
      });
      // Escenario 2: Nec cap 500, spent 700; Ocio cap 300, spent 200 -> netDeficit 100, ocioToAhorro 0, necToNext 0
      mocks.docs.set(prevMonthPath, {
        totalIncomeCents: 100_000,
        distribution: { necesidad: 50, ocio: 30, ahorro: 20 },
        capsCents: { necesidad: 50_000, ocio: 30_000 },
        spentCents: { necesidad: 70_000, ocio: 20_000 },
        borrowedCapsCents: { necesidad: 0, ocio: 0 },
        loanFundedSpentCents: { necesidad: 0, ocio: 0 },
        ahorroContributedCents: 20_000,
        incomeCount: 1,
        closed: false,
      });

      const res = await checkAndCloseMonth("u");
      expect(res).toEqual({ closedMonthId: "2026-08" });

      expect(mocks.update).toHaveBeenCalledWith(prevMonthPath, {
        closed: true,
        remainder: {
          ocioToAhorroCents: 0,
          necesidadToNextMonthCents: 0,
          netDeficitCents: 10_000,
        },
      });
      // No se incrementa savingsTotalCents cuando ocioToAhorroCents === 0
      expect(mocks.update).toHaveBeenCalledTimes(2);
      expect(mocks.update).toHaveBeenCalledWith(userPath, {
        lastClosedMonth: "2026-09",
      });
      expect(mocks.set).toHaveBeenCalledWith(
        monthPath,
        expect.objectContaining({
          capsCents: { necesidad: 0, ocio: 0 },
          inheritedNecesidadCents: 0,
        }),
      );
    });
  });
});
