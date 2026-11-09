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
  registerExpense,
  registerIncome,
  updateExpense,
  updateIncome,
  withdrawFromFund,
} from "./transactionService";
import {
  checkAndCloseMonth,
  ensureCurrentMonth,
  hasDistributedIncomes,
  updateDistributionNow,
} from "./monthService";

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
          ocioToNextMonthCents: 0,
          necesidadToNextMonthCents: 0,
          necesidadSweptToAhorroCents: 0,
          netDeficitCents: 10_000,
          borrowedNecesidadCents: 0,
          borrowedOcioCents: 0,
          deficitResolution: "none",
          closedAt: "SERVER_TIMESTAMP",
        },
      });
      // No se incrementa savingsTotalCents cuando ocioToAhorroCents === 0
      expect(mocks.update).toHaveBeenCalledTimes(2);
      expect(mocks.update).toHaveBeenCalledWith(userPath, {
        lastClosedMonth: "2026-09",
        pendingCloseMonthId: null,
        unseenClosedMonthId: "2026-08",
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

  describe("F2a: registerIncome, registerExpense y ensureCurrentMonth", () => {
    it("registerIncome registra un ingreso normal (1000 -> Necesidad 500 / Ocio 300 / Ahorro 200) releyendo month.distribution", async () => {
      mocks.docs.set(userPath, {
        distribution: { necesidad: 60, ocio: 20, ahorro: 20 },
        savingsTotalCents: 10_000,
      });
      mocks.docs.set(monthPath, {
        closed: false,
        distribution: { necesidad: 50, ocio: 30, ahorro: 20 },
        capsCents: { necesidad: 0, ocio: 0 },
        spentCents: { necesidad: 0, ocio: 0 },
        incomeCount: 1,
      });

      const result = await registerIncome("u", {
        monthId: "2026-09",
        amountCents: 100_000,
        source: "Sueldo",
        sourceId: "src-1",
        date: "2026-09-15",
        description: "Pago mensual",
      });

      expect(result.distribution).toEqual({
        necesidad: 50_000,
        ocio: 30_000,
        ahorro: 20_000,
      });
      expect(mocks.set).toHaveBeenCalledWith(
        `${monthPath}/transactions/generated-1`,
        expect.objectContaining({
          type: "income",
          source: "Sueldo",
          sourceId: "src-1",
          transactionDate: "2026-09-15",
          amountCents: 100_000,
          distribution: {
            necesidad: 50_000,
            ocio: 30_000,
            ahorro: 20_000,
          },
          description: "Pago mensual",
        }),
      );
      expect(mocks.update).toHaveBeenCalledWith(monthPath, {
        totalIncomeCents: { __op: "increment", value: 100_000 },
        incomeCount: { __op: "increment", value: 1 },
        distributedIncomeCount: { __op: "increment", value: 1 },
        "capsCents.necesidad": { __op: "increment", value: 50_000 },
        "capsCents.ocio": { __op: "increment", value: 30_000 },
        ahorroContributedCents: { __op: "increment", value: 20_000 },
      });
      expect(mocks.update).toHaveBeenCalledWith(userPath, {
        savingsTotalCents: { __op: "increment", value: 20_000 },
      });
    });

    it("registerIncome registra un aporte directo a Ahorro (isDirectSavings) con las mismas escrituras actuales", async () => {
      mocks.docs.set(userPath, {
        distribution: { necesidad: 50, ocio: 30, ahorro: 20 },
        savingsTotalCents: 0,
      });
      mocks.docs.set(monthPath, {
        closed: false,
        distribution: { necesidad: 50, ocio: 30, ahorro: 20 },
        capsCents: { necesidad: 0, ocio: 0 },
        spentCents: { necesidad: 0, ocio: 0 },
        incomeCount: 0,
      });

      const result = await registerIncome("u", {
        monthId: "2026-09",
        amountCents: 25_000,
        isDirectSavings: true,
        date: "2026-09-15",
        description: "Venta",
      });

      expect(result.distribution).toEqual({
        necesidad: 0,
        ocio: 0,
        ahorro: 25_000,
      });
      expect(mocks.set).toHaveBeenCalledWith(
        `${monthPath}/transactions/generated-1`,
        expect.objectContaining({
          type: "income",
          source: "Aporte directo",
          transactionDate: "2026-09-15",
          amountCents: 25_000,
          distribution: { necesidad: 0, ocio: 0, ahorro: 25_000 },
          isDirectSavings: true,
          description: "Venta",
        }),
      );
      expect(mocks.update).toHaveBeenCalledWith(monthPath, {
        directSavingsCents: { __op: "increment", value: 25_000 },
        incomeCount: { __op: "increment", value: 1 },
        ahorroContributedCents: { __op: "increment", value: 25_000 },
      });
      expect(mocks.update).toHaveBeenCalledWith(userPath, {
        savingsTotalCents: { __op: "increment", value: 25_000 },
      });
    });

    it("registerExpense registra un gasto normal e incrementa spentCents de la categoría", async () => {
      mocks.docs.set(monthPath, {
        closed: false,
        distribution: { necesidad: 50, ocio: 30, ahorro: 20 },
        capsCents: { necesidad: 50_000, ocio: 30_000 },
        spentCents: { necesidad: 0, ocio: 0 },
      });

      await registerExpense("u", {
        monthId: "2026-09",
        category: "necesidad",
        subcategory: "Supermercado",
        paymentMethod: "Débito",
        amountCents: 12_500,
        date: "2026-09-14",
        description: "Compra semanal",
        tags: ["casa"],
      });

      expect(mocks.set).toHaveBeenCalledWith(
        `${monthPath}/transactions/generated-1`,
        expect.objectContaining({
          type: "expense",
          category: "necesidad",
          subcategory: "Supermercado",
          paymentMethod: "Débito",
          amountCents: 12_500,
          transactionDate: "2026-09-14",
          description: "Compra semanal",
          tags: ["casa"],
        }),
      );
      expect(mocks.update).toHaveBeenCalledWith(monthPath, {
        "spentCents.necesidad": { __op: "increment", value: 12_500 },
      });
    });

    it("registerExpense rechaza gasto con fecha inválida (futura o fuera del mes) sin tocar Firestore", async () => {
      mocks.docs.set(monthPath, { closed: false });

      await expect(
        registerExpense("u", {
          monthId: "2026-09",
          category: "ocio",
          subcategory: "Restaurante",
          paymentMethod: "Efectivo",
          amountCents: 5_000,
          date: "2026-09-20", // Hoy es 2026-09-15 en fakeTimers
        }),
      ).rejects.toThrow("La fecha no puede estar en el futuro.");

      await expect(
        registerExpense("u", {
          monthId: "2026-09",
          category: "ocio",
          subcategory: "Restaurante",
          paymentMethod: "Efectivo",
          amountCents: 5_000,
          date: "2026-08-31",
        }),
      ).rejects.toThrow("La fecha debe pertenecer al mes actual abierto.");

      expect(mocks.set).not.toHaveBeenCalled();
      expect(mocks.update).not.toHaveBeenCalled();
    });

    it("crea el mes inexistente automáticamente mediante ensureCurrentMonth al registrar un ingreso o llamarlo directamente", async () => {
      mocks.docs.set(userPath, {
        distribution: { necesidad: 50, ocio: 30, ahorro: 20 },
        lastClosedMonth: null,
        savingsTotalCents: 0,
      });

      // months/2026-09 no existe aún en mocks.docs
      const result = await registerIncome("u", {
        monthId: "2026-09",
        amountCents: 100_000,
        source: "Sueldo",
        sourceId: "src-1",
        date: "2026-09-15",
      });

      expect(result.distribution).toEqual({
        necesidad: 50_000,
        ocio: 30_000,
        ahorro: 20_000,
      });
      // Se creó el documento del mes y luego la transacción de ingreso
      expect(mocks.set).toHaveBeenCalledWith(
        monthPath,
        expect.objectContaining({
          totalIncomeCents: 0,
          distribution: { necesidad: 50, ocio: 30, ahorro: 20 },
          closed: false,
        }),
      );
      expect(mocks.set).toHaveBeenCalledWith(
        expect.stringContaining(`${monthPath}/transactions/`),
        expect.objectContaining({
          type: "income",
          amountCents: 100_000,
        }),
      );

      // También si lastClosedMonth ya apuntaba al mes actual pero faltaba el doc del mes
      mocks.set.mockClear();
      mocks.docs.set(userPath, {
        distribution: { necesidad: 50, ocio: 30, ahorro: 20 },
        lastClosedMonth: "2026-09",
        savingsTotalCents: 0,
      });
      const ensured = await ensureCurrentMonth("u");
      expect(ensured.distribution).toEqual({
        necesidad: 50,
        ocio: 30,
        ahorro: 20,
      });
      expect(mocks.set).toHaveBeenCalledWith(
        monthPath,
        expect.objectContaining({
          closed: false,
          distribution: { necesidad: 50, ocio: 30, ahorro: 20 },
        }),
      );
    });
  });

  describe("F2b: gate distributedIncomeCount y modos A/B de cambio de %", () => {
    it("aporte directo como primer movimiento NO bloquea el cambio de % del mes", async () => {
      mocks.docs.set(userPath, {
        distribution: { necesidad: 50, ocio: 30, ahorro: 20 },
        savingsTotalCents: 25_000,
      });
      // Mes con un aporte directo (incomeCount: 1, distributedIncomeCount: 0, totalIncomeCents: 0)
      mocks.docs.set(monthPath, {
        closed: false,
        distribution: { necesidad: 50, ocio: 30, ahorro: 20 },
        totalIncomeCents: 0,
        directSavingsCents: 25_000,
        incomeCount: 1,
        distributedIncomeCount: 0,
        capsCents: { necesidad: 0, ocio: 0 },
        spentCents: { necesidad: 0, ocio: 0 },
        ahorroContributedCents: 25_000,
      });

      expect(
        hasDistributedIncomes({
          distributedIncomeCount: 0,
          totalIncomeCents: 0,
        }),
      ).toBe(false);

      // Cambiar a 40/30/30 actualiza tanto userProfile como month.distribution
      await updateDistributionNow(
        "u",
        { necesidad: 40, ocio: 30, ahorro: 30 },
        "next_month",
      );

      expect(mocks.update).toHaveBeenCalledWith(userPath, {
        distribution: { necesidad: 40, ocio: 30, ahorro: 30 },
      });
      expect(mocks.update).toHaveBeenCalledWith(monthPath, {
        distribution: { necesidad: 40, ocio: 30, ahorro: 30 },
      });

      // ensureCurrentMonth / checkAndCloseMonth también sincroniza si solo hubo aporte directo
      mocks.update.mockClear();
      mocks.docs.set(userPath, {
        distribution: { necesidad: 60, ocio: 20, ahorro: 20 },
        lastClosedMonth: "2026-09",
        savingsTotalCents: 25_000,
      });
      await ensureCurrentMonth("u");
      expect(mocks.update).toHaveBeenCalledWith(monthPath, {
        distribution: { necesidad: 60, ocio: 20, ahorro: 20 },
      });
    });

    it("modo next_income: ingreso 1 con 50/30/20, cambio a 40/30/30, ingreso 2 reparte con el nuevo % y el primero no cambia", async () => {
      mocks.docs.set(userPath, {
        distribution: { necesidad: 50, ocio: 30, ahorro: 20 },
        savingsTotalCents: 0,
      });
      mocks.docs.set(monthPath, {
        closed: false,
        distribution: { necesidad: 50, ocio: 30, ahorro: 20 },
        totalIncomeCents: 0,
        incomeCount: 0,
        distributedIncomeCount: 0,
        capsCents: { necesidad: 0, ocio: 0 },
        spentCents: { necesidad: 0, ocio: 0 },
        ahorroContributedCents: 0,
      });

      // Ingreso 1: S/ 1000 con 50/30/20
      const r1 = await registerIncome("u", {
        monthId: "2026-09",
        amountCents: 100_000,
        source: "Sueldo",
        date: "2026-09-10",
      });
      expect(r1.distribution).toEqual({
        necesidad: 50_000,
        ocio: 30_000,
        ahorro: 20_000,
      });

      // Reflejar estado tras ingreso 1
      mocks.docs.set(monthPath, {
        closed: false,
        distribution: { necesidad: 50, ocio: 30, ahorro: 20 },
        totalIncomeCents: 100_000,
        incomeCount: 1,
        distributedIncomeCount: 1,
        capsCents: { necesidad: 50_000, ocio: 30_000 },
        spentCents: { necesidad: 0, ocio: 0 },
        ahorroContributedCents: 20_000,
      });
      mocks.docs.set(`${monthPath}/transactions/tx1`, {
        type: "income",
        amountCents: 100_000,
        source: "Sueldo",
        transactionDate: "2026-09-10",
        distribution: { necesidad: 50_000, ocio: 30_000, ahorro: 20_000 },
      });

      // Cambio en modo next_income a 40/30/30
      mocks.update.mockClear();
      await updateDistributionNow(
        "u",
        { necesidad: 40, ocio: 30, ahorro: 30 },
        "next_income",
      );
      expect(mocks.update).toHaveBeenCalledWith(userPath, {
        distribution: { necesidad: 40, ocio: 30, ahorro: 30 },
      });
      expect(mocks.update).toHaveBeenCalledWith(monthPath, {
        distribution: { necesidad: 40, ocio: 30, ahorro: 30 },
      });
      // No toca capsCents ni savingsTotalCents ni tx1
      expect(mocks.update).toHaveBeenCalledTimes(2);

      // Reflejar nuevo month.distribution y registrar Ingreso 2: S/ 1000
      mocks.docs.set(monthPath, {
        ...mocks.docs.get(monthPath)!,
        distribution: { necesidad: 40, ocio: 30, ahorro: 30 },
      });
      const r2 = await registerIncome("u", {
        monthId: "2026-09",
        amountCents: 100_000,
        source: "Bono",
        date: "2026-09-15",
      });
      expect(r2.distribution).toEqual({
        necesidad: 40_000,
        ocio: 30_000,
        ahorro: 30_000,
      });
      // Ingreso 1 conserva su tx.distribution intacto
      expect(mocks.docs.get(`${monthPath}/transactions/tx1`)?.distribution).toEqual({
        necesidad: 50_000,
        ocio: 30_000,
        ahorro: 20_000,
      });
    });

    it("editar o borrar el ingreso 1 tras cambiar los % usa su split original (50/30/20) y cuadra al centavo", async () => {
      mocks.docs.set(userPath, {
        distribution: { necesidad: 40, ocio: 30, ahorro: 30 },
        savingsTotalCents: 50_000,
        savingsGoals: [],
      });
      // Mes ya tiene 40/30/30 y suma de ingreso 1 (50k/30k/20k) + ingreso 2 (40k/30k/30k)
      mocks.docs.set(monthPath, {
        closed: false,
        distribution: { necesidad: 40, ocio: 30, ahorro: 30 },
        totalIncomeCents: 200_000,
        incomeCount: 2,
        distributedIncomeCount: 2,
        capsCents: { necesidad: 90_000, ocio: 60_000 },
        spentCents: { necesidad: 0, ocio: 0 },
        ahorroContributedCents: 50_000,
      });
      mocks.docs.set(txPath, {
        type: "income",
        amountCents: 100_000,
        source: "Sueldo",
        transactionDate: "2026-09-10",
        distribution: { necesidad: 50_000, ocio: 30_000, ahorro: 20_000 },
      });

      // 1) Editar ingreso 1 de S/ 1000 a S/ 2000 debe reescalar con 50/30/20 (+50k/+30k/+20k), NO con 40/30/30
      await updateIncome("u", "2026-09", "tx1", {
        amountCents: 200_000,
        source: "Sueldo",
      });

      expect(mocks.update).toHaveBeenCalledWith(txPath, {
        amountCents: 200_000,
        source: "Sueldo",
        description: { __op: "deleteField" },
        distribution: { necesidad: 100_000, ocio: 60_000, ahorro: 40_000 },
      });
      expect(mocks.update).toHaveBeenCalledWith(monthPath, {
        totalIncomeCents: { __op: "increment", value: 100_000 },
        "capsCents.necesidad": { __op: "increment", value: 50_000 },
        "capsCents.ocio": { __op: "increment", value: 30_000 },
        ahorroContributedCents: { __op: "increment", value: 20_000 },
      });

      // 2) Borrar ingreso 1 revierte exactamente su tx.distribution (-50k/-30k/-20k) y decrementa distributedIncomeCount
      mocks.update.mockClear();
      await deleteTransaction("u", "2026-09", "tx1");

      expect(mocks.update).toHaveBeenCalledWith(monthPath, {
        totalIncomeCents: { __op: "increment", value: -100_000 },
        incomeCount: { __op: "increment", value: -1 },
        distributedIncomeCount: { __op: "increment", value: -1 },
        "capsCents.necesidad": { __op: "increment", value: -50_000 },
        "capsCents.ocio": { __op: "increment", value: -30_000 },
        ahorroContributedCents: { __op: "increment", value: -20_000 },
      });
      expect(mocks.update).toHaveBeenCalledWith(userPath, {
        savingsTotalCents: { __op: "increment", value: -20_000 },
      });
    });

    it("modo next_month: el mes actual no cambia y el mes siguiente se crea con el nuevo %", async () => {
      mocks.docs.set(userPath, {
        distribution: { necesidad: 50, ocio: 30, ahorro: 20 },
        lastClosedMonth: "2026-09",
        savingsTotalCents: 20_000,
      });
      mocks.docs.set(monthPath, {
        closed: false,
        distribution: { necesidad: 50, ocio: 30, ahorro: 20 },
        totalIncomeCents: 100_000,
        incomeCount: 1,
        distributedIncomeCount: 1,
        capsCents: { necesidad: 50_000, ocio: 30_000 },
        spentCents: { necesidad: 50_000, ocio: 30_000 },
        ahorroContributedCents: 20_000,
      });

      await updateDistributionNow(
        "u",
        { necesidad: 40, ocio: 30, ahorro: 30 },
        "next_month",
      );

      // Solo cambia userProfile.distribution; monthPath no se toca
      expect(mocks.update).toHaveBeenCalledTimes(1);
      expect(mocks.update).toHaveBeenCalledWith(userPath, {
        distribution: { necesidad: 40, ocio: 30, ahorro: 30 },
      });

      // Al avanzar al mes siguiente (2026-10), el nuevo mes se crea con 40/30/30
      mocks.docs.set(userPath, {
        distribution: { necesidad: 40, ocio: 30, ahorro: 30 },
        lastClosedMonth: "2026-09",
        savingsTotalCents: 20_000,
      });
      vi.setSystemTime(new Date(2026, 9, 2, 10, 0)); // 2026-10-02
      await checkAndCloseMonth("u");

      expect(mocks.set).toHaveBeenCalledWith(
        "users/u/months/2026-10",
        expect.objectContaining({
          distribution: { necesidad: 40, ocio: 30, ahorro: 30 },
          distributedIncomeCount: 0,
        }),
      );
    });

    it("meses legacy sin distributedIncomeCount funcionan usando el fallback totalIncomeCents > 0", async () => {
      expect(
        hasDistributedIncomes({
          totalIncomeCents: 100_000,
        }),
      ).toBe(true);
      expect(
        hasDistributedIncomes({
          totalIncomeCents: 0,
        }),
      ).toBe(false);

      // En un mes legacy con totalIncomeCents > 0, ensureCurrentMonth NO sobrescribe month.distribution
      mocks.docs.set(userPath, {
        distribution: { necesidad: 40, ocio: 30, ahorro: 30 },
        lastClosedMonth: "2026-09",
        savingsTotalCents: 20_000,
      });
      mocks.docs.set(monthPath, {
        closed: false,
        distribution: { necesidad: 50, ocio: 30, ahorro: 20 },
        totalIncomeCents: 100_000,
        incomeCount: 1,
        capsCents: { necesidad: 50_000, ocio: 30_000 },
        spentCents: { necesidad: 0, ocio: 0 },
      });
      await ensureCurrentMonth("u");
      expect(mocks.update).not.toHaveBeenCalled();
    });
  });

  describe("F4: cierre multi-mes y purchaseGoalExpense con precio real", () => {
    it("cierre multi-mes: usuario que no abre la app por 2 meses (2026-07 -> 2026-09) con déficit en el primero y herencia de Necesidad; ningún mes intermedio queda abierto", async () => {
      // Configurar mocks.set y mocks.update para persistir en mocks.docs entre transacciones del bucle multi-mes
      const applyPatch = (
        target: Record<string, unknown>,
        patch: Record<string, unknown>,
      ): Record<string, unknown> => {
        const next: Record<string, unknown> = structuredClone(target);
        for (const [key, rawVal] of Object.entries(patch)) {
          const parts = key.split(".");
          let cursor: Record<string, unknown> = next;
          for (let i = 0; i < parts.length - 1; i += 1) {
            const part = parts[i];
            const existing = cursor[part];
            cursor[part] =
              existing && typeof existing === "object"
                ? { ...(existing as Record<string, unknown>) }
                : {};
            cursor = cursor[part] as Record<string, unknown>;
          }
          const leaf = parts[parts.length - 1];
          if (
            rawVal &&
            typeof rawVal === "object" &&
            (rawVal as { __op?: string }).__op === "increment"
          ) {
            const currentNum =
              typeof cursor[leaf] === "number" ? (cursor[leaf] as number) : 0;
            cursor[leaf] =
              currentNum + ((rawVal as { value: number }).value ?? 0);
          } else {
            cursor[leaf] = rawVal;
          }
        }
        return next;
      };

      mocks.set.mockImplementation(
        (path: string, data: Record<string, unknown>) => {
          mocks.docs.set(path, structuredClone(data));
        },
      );
      mocks.update.mockImplementation(
        (path: string, patch: Record<string, unknown>) => {
          const prev = mocks.docs.get(path) ?? {};
          mocks.docs.set(path, applyPatch(prev, patch));
        },
      );

      // Estado inicial en 2026-07:
      // Necesidad: cap 500 (50_000), spent 350 (35_000) -> +150 (15_000)
      // Ocio: cap 200 (20_000), spent 400 (40_000) -> -200 (-20_000)
      // Remanentes de 2026-07: ocioToAhorro = 0, necesidadToNextMonth = 0, netDeficit = 5_000 (S/ 50)
      mocks.docs.set(userPath, {
        distribution: { necesidad: 50, ocio: 30, ahorro: 20 },
        lastClosedMonth: "2026-07",
        savingsTotalCents: 100_000,
      });
      mocks.docs.set("users/u/months/2026-07", {
        closed: false,
        distribution: { necesidad: 50, ocio: 30, ahorro: 20 },
        totalIncomeCents: 100_000,
        incomeCount: 1,
        distributedIncomeCount: 1,
        capsCents: { necesidad: 50_000, ocio: 20_000 },
        spentCents: { necesidad: 35_000, ocio: 40_000 },
        ahorroContributedCents: 30_000,
      });

      // Además probamos el caso en que otro salto sí tiene herencia de Necesidad:
      // Si el usuario abre en 2026-09 (2 meses después: 2026-07 -> 2026-08 -> 2026-09)
      vi.setSystemTime(new Date(2026, 8, 15, 12, 0)); // 2026-09-15
      await ensureCurrentMonth("u");

      const m07 = mocks.docs.get("users/u/months/2026-07")!;
      const m08 = mocks.docs.get("users/u/months/2026-08")!;
      const m09 = mocks.docs.get("users/u/months/2026-09")!;
      const userAfter = mocks.docs.get(userPath)!;

      expect(m07.closed).toBe(true);
      expect(m07.remainder).toEqual({
        ocioToAhorroCents: 0,
        ocioToNextMonthCents: 0,
        necesidadToNextMonthCents: 0,
        necesidadSweptToAhorroCents: 0,
        netDeficitCents: 5_000,
        borrowedNecesidadCents: 0,
        borrowedOcioCents: 0,
        deficitResolution: "none",
        closedAt: "SERVER_TIMESTAMP",
      });
      // Mes intermedio 2026-08 fue creado y cerrado en orden cronológico
      expect(m08.closed).toBe(true);
      expect(m08.capsCents).toEqual({ necesidad: 0, ocio: 0 });
      expect(m08.remainder).toEqual({
        ocioToAhorroCents: 0,
        ocioToNextMonthCents: 0,
        necesidadToNextMonthCents: 0,
        necesidadSweptToAhorroCents: 0,
        netDeficitCents: 0,
        borrowedNecesidadCents: 0,
        borrowedOcioCents: 0,
        deficitResolution: "none",
        closedAt: "SERVER_TIMESTAMP",
      });
      // Mes actual 2026-09 queda abierto y el cursor apunta a 2026-09
      expect(m09.closed).toBe(false);
      expect(userAfter.lastClosedMonth).toBe("2026-09");
      expect(userAfter.savingsTotalCents).toBe(100_000);

      // Segundo escenario: 2 meses sin abrir (2026-09 -> 2026-11) donde 2026-09 deja
      // sobrante neto de Necesidad (necesidad +25_000, ocio -5_000 -> necesidadToNextMonth = 20_000)
      // que se hereda a 2026-10 y luego de 2026-10 (sin gastos) pasa íntegro a 2026-11.
      mocks.docs.set("users/u/months/2026-09", {
        ...m09,
        closed: false,
        capsCents: { necesidad: 50_000, ocio: 20_000 },
        spentCents: { necesidad: 25_000, ocio: 25_000 },
      });
      vi.setSystemTime(new Date(2026, 10, 5, 12, 0)); // 2026-11-05
      const notice = await checkAndCloseMonth("u");

      const m09Closed = mocks.docs.get("users/u/months/2026-09")!;
      const m10Closed = mocks.docs.get("users/u/months/2026-10")!;
      const m11Open = mocks.docs.get("users/u/months/2026-11")!;

      expect(m09Closed.closed).toBe(true);
      expect(m09Closed.remainder).toEqual({
        ocioToAhorroCents: 0,
        ocioToNextMonthCents: 0,
        necesidadToNextMonthCents: 20_000,
        necesidadSweptToAhorroCents: 0,
        netDeficitCents: 0,
        borrowedNecesidadCents: 0,
        borrowedOcioCents: 0,
        deficitResolution: "none",
        closedAt: "SERVER_TIMESTAMP",
      });
      expect(m10Closed.closed).toBe(true);
      expect(m10Closed.capsCents).toEqual({ necesidad: 20_000, ocio: 0 });
      expect(m10Closed.remainder).toEqual({
        ocioToAhorroCents: 0,
        ocioToNextMonthCents: 0,
        necesidadToNextMonthCents: 20_000,
        necesidadSweptToAhorroCents: 0,
        netDeficitCents: 0,
        borrowedNecesidadCents: 0,
        borrowedOcioCents: 0,
        deficitResolution: "none",
        closedAt: "SERVER_TIMESTAMP",
      });
      expect(m11Open.closed).toBe(false);
      expect(m11Open.capsCents).toEqual({ necesidad: 20_000, ocio: 0 });
      expect(notice?.closedMonthId).toBe("2026-10");

      mocks.set.mockReset();
      mocks.update.mockReset();
    });

    it("purchaseGoalExpense: asignado 3,500 y precio real 3,199 -> descuenta 3,199 de savingsTotalCents y libera 301 a sin asignar", async () => {
      mocks.docs.set(userPath, {
        savingsTotalCents: 350_000,
        savingsGoals: [
          {
            id: "g-laptop",
            name: "Laptop",
            kind: "compra",
            targetCents: 350_000,
            allocatedCents: 350_000,
          },
        ],
      });
      mocks.docs.set(monthPath, {
        closed: false,
        capsCents: { necesidad: 0, ocio: 0 },
        spentCents: { necesidad: 0, ocio: 0 },
      });

      await purchaseGoalExpense("u", "2026-09", {
        goalId: "g-laptop",
        paymentMethod: "Tarjeta débito",
        date: "2026-09-15",
        actualAmountCents: 319_900,
      });

      expect(mocks.set).toHaveBeenCalledWith(
        `${monthPath}/transactions/generated-1`,
        expect.objectContaining({
          type: "expense",
          category: "ahorro",
          amountCents: 319_900,
          goalId: "g-laptop",
        }),
      );
      expect(mocks.update).toHaveBeenCalledWith(userPath, {
        savingsTotalCents: { __op: "increment", value: -319_900 },
        savingsGoals: [
          expect.objectContaining({
            id: "g-laptop",
            allocatedCents: 0,
            purchaseCount: 1,
            lastPurchasedAt: "2026-09-15",
          }),
        ],
      });
      // El ahorro restante pasa a ser 350_000 - 319_900 = 30_100 (S/ 301) con allocatedCents = 0 -> S/ 301 sin asignar
    });

    it("purchaseGoalExpense: asignado 3,500 y precio real 3,600 con 50 sin asignar -> falla por falta de ahorro sin asignar", async () => {
      mocks.docs.set(userPath, {
        savingsTotalCents: 355_000, // 3,500 en meta + 50 sin asignar
        savingsGoals: [
          {
            id: "g-laptop",
            name: "Laptop",
            kind: "compra",
            targetCents: 350_000,
            allocatedCents: 350_000,
          },
        ],
      });
      mocks.docs.set(monthPath, {
        closed: false,
        capsCents: { necesidad: 0, ocio: 0 },
        spentCents: { necesidad: 0, ocio: 0 },
      });

      await expect(
        purchaseGoalExpense("u", "2026-09", {
          goalId: "g-laptop",
          paymentMethod: "Tarjeta débito",
          date: "2026-09-15",
          actualAmountCents: 360_000,
        }),
      ).rejects.toThrow(/ahorro sin asignar/i);
      expect(mocks.update).not.toHaveBeenCalled();
    });

    it("purchaseGoalExpense: asignado 3,500 y precio real 3,600 con 200 sin asignar -> pasa y descuenta 3,600", async () => {
      mocks.docs.set(userPath, {
        savingsTotalCents: 370_000, // 3,500 en meta + 200 sin asignar
        savingsGoals: [
          {
            id: "g-laptop",
            name: "Laptop",
            kind: "compra",
            targetCents: 350_000,
            allocatedCents: 350_000,
          },
        ],
      });
      mocks.docs.set(monthPath, {
        closed: false,
        capsCents: { necesidad: 0, ocio: 0 },
        spentCents: { necesidad: 0, ocio: 0 },
      });

      await purchaseGoalExpense("u", "2026-09", {
        goalId: "g-laptop",
        paymentMethod: "Tarjeta débito",
        date: "2026-09-15",
        actualAmountCents: 360_000,
      });

      expect(mocks.update).toHaveBeenCalledWith(userPath, {
        savingsTotalCents: { __op: "increment", value: -360_000 },
        savingsGoals: [
          expect.objectContaining({
            id: "g-laptop",
            allocatedCents: 0,
            purchaseCount: 1,
            lastPurchasedAt: "2026-09-15",
          }),
        ],
      });
    });
  });
});
