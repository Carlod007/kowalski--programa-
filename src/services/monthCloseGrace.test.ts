/* eslint-disable @typescript-eslint/no-explicit-any -- in-memory Firestore fixture */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

type DocData = Record<string, any>;

const mocks = vi.hoisted(() => ({
  docs: new Map<string, DocData>(),
  autoId: 0,
  set: vi.fn(),
  update: vi.fn(),
}));

vi.mock("@/lib/firebase", () => ({ db: "db" }));
vi.mock("firebase/firestore", () => {
  function reference(...parts: (string | { path: string })[]) {
    const filtered = parts.filter((part) => part !== "db");
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
        .map((part) => (typeof part === "string" ? part : part.path))
        .join("/"),
    };
  }

  function applyPatch(target: DocData, patch: DocData): DocData {
    const next: DocData = structuredClone(target);
    for (const [key, rawValue] of Object.entries(patch)) {
      const parts = key.split(".");
      let cursor: DocData = next;
      for (let index = 0; index < parts.length - 1; index += 1) {
        const part = parts[index];
        cursor[part] =
          cursor[part] && typeof cursor[part] === "object"
            ? { ...cursor[part] }
            : {};
        cursor = cursor[part] as DocData;
      }
      const leaf = parts.at(-1)!;
      if (rawValue && typeof rawValue === "object" && rawValue.__op === "increment") {
        const current = typeof cursor[leaf] === "number" ? cursor[leaf] : 0;
        cursor[leaf] = current + Number(rawValue.value ?? 0);
      } else {
        cursor[leaf] = rawValue;
      }
    }
    return next;
  }

  return {
    doc: reference,
    collection: reference,
    increment: (value: number) => ({ __op: "increment", value }),
    serverTimestamp: () => "SERVER_TIMESTAMP",
    runTransaction: async (
      _db: unknown,
      callback: (transaction: unknown) => unknown,
    ) =>
      callback({
        get: async (ref: { path: string }) => ({
          exists: () => mocks.docs.has(ref.path),
          data: () => mocks.docs.get(ref.path),
        }),
        set: (ref: { path: string }, data: DocData) => {
          mocks.set(ref.path, data);
          mocks.docs.set(ref.path, structuredClone(data));
        },
        update: (ref: { path: string }, data: DocData) => {
          mocks.update(ref.path, data);
          mocks.docs.set(ref.path, applyPatch(mocks.docs.get(ref.path) ?? {}, data));
        },
      }),
  };
});

import {
  checkAndCloseMonth,
  confirmMonthClose,
  ensureCurrentMonth,
} from "./monthService";
import { recordClosedMonthAdjustment, registerExpense } from "./transactionService";

const userPath = "users/u";
const percentages = { necesidad: 50, ocio: 30, ahorro: 20 };
const zero = { necesidad: 0, ocio: 0 };

function month(extra: DocData = {}): DocData {
  return {
    totalIncomeCents: 0,
    distribution: percentages,
    capsCents: zero,
    spentCents: zero,
    borrowedCapsCents: zero,
    loanFundedSpentCents: zero,
    ahorroContributedCents: 0,
    incomeCount: 0,
    distributedIncomeCount: 0,
    closed: false,
    createdAt: "SEEDED",
    ...extra,
  };
}

function seed(path: string, data: DocData) {
  mocks.docs.set(path, structuredClone(data));
}

function deficitMonth(extra: DocData = {}) {
  // Ingreso 1000: Necesidad 500 / Ocio 300. Gastado 700 / 200 -> déficit 100.
  return month({
    capsCents: { necesidad: 50_000, ocio: 30_000 },
    spentCents: { necesidad: 70_000, ocio: 20_000 },
    ...extra,
  });
}

function user(extra: DocData = {}) {
  return {
    distribution: percentages,
    lastClosedMonth: "2026-10",
    savingsTotalCents: 0,
    savingsGoals: [],
    ...extra,
  };
}

function monthDoc(id: string) {
  return mocks.docs.get(`${userPath}/months/${id}`)!;
}

describe("F5: cierre revisable, gracia y ajustes", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    mocks.docs.clear();
    mocks.autoId = 0;
    mocks.set.mockClear();
    mocks.update.mockClear();
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });

  it("día 1: crea el mes nuevo y deja el anterior abierto como pendiente", async () => {
    const now = new Date(2026, 10, 1, 10, 0);
    vi.setSystemTime(now);
    seed(userPath, user());
    seed(`${userPath}/months/2026-10`, month());

    await ensureCurrentMonth("u", now);

    expect(monthDoc("2026-10").closed).toBe(false);
    expect(monthDoc("2026-11").closed).toBe(false);
    expect(mocks.docs.get(userPath)).toMatchObject({
      lastClosedMonth: "2026-11",
      pendingCloseMonthId: "2026-10",
    });
    expect(mocks.docs.get(userPath)?.unseenClosedMonthId ?? null).toBeNull();
  });

  it("día 2: un gasto fechado el día 30 entra al mes anterior abierto", async () => {
    vi.setSystemTime(new Date(2026, 10, 2, 10, 0));
    seed(
      userPath,
      user({
        lastClosedMonth: "2026-11",
        pendingCloseMonthId: "2026-10",
      }),
    );
    seed(`${userPath}/months/2026-11`, month());
    seed(`${userPath}/months/2026-10`, month({
      capsCents: { necesidad: 100_000, ocio: 0 },
    }));

    await registerExpense("u", {
      category: "necesidad",
      subcategory: "Salud",
      paymentMethod: "Efectivo",
      amountCents: 1_500,
      date: "2026-10-30",
    });

    const previousTransactions = [...mocks.docs.keys()].filter((path) =>
      path.startsWith(`${userPath}/months/2026-10/transactions/`),
    );
    const currentTransactions = [...mocks.docs.keys()].filter((path) =>
      path.startsWith(`${userPath}/months/2026-11/transactions/`),
    );
    expect(previousTransactions).toHaveLength(1);
    expect(currentTransactions).toHaveLength(0);
    expect(monthDoc("2026-10").spentCents.necesidad).toBe(1_500);
    expect(monthDoc("2026-11").spentCents.necesidad).toBe(0);
  });

  it("confirmar con covered_by_savings cubre el déficit solo con ahorro sin asignar", async () => {
    vi.setSystemTime(new Date(2026, 10, 2, 10, 0));
    seed(
      userPath,
      user({
        lastClosedMonth: "2026-11",
        pendingCloseMonthId: "2026-10",
        savingsTotalCents: 20_000,
      }),
    );
    seed(`${userPath}/months/2026-10`, deficitMonth());
    seed(`${userPath}/months/2026-11`, month());

    const result = await confirmMonthClose("u", "2026-10", "covered_by_savings");

    expect(result).toEqual({
      closedMonthId: "2026-10",
      coveredBySavingsCents: 10_000,
      uncoveredDeficitCents: 0,
      carriedDeficitCents: 0,
    });
    expect(monthDoc("2026-10")).toMatchObject({
      closed: true,
      remainder: {
        netDeficitCents: 10_000,
        deficitResolution: "covered_by_savings",
        coveredBySavingsCents: 10_000,
        uncoveredDeficitCents: 0,
      },
    });
    expect(mocks.docs.get(userPath)).toMatchObject({
      savingsTotalCents: 10_000,
      pendingCloseMonthId: null,
      unseenClosedMonthId: "2026-10",
    });
  });

  it("cubrir con ahorro nunca deja ahorro negativo ni sobreasignado a metas", async () => {
    vi.setSystemTime(new Date(2026, 10, 2, 10, 0));
    seed(
      userPath,
      user({
        lastClosedMonth: "2026-11",
        pendingCloseMonthId: "2026-10",
        savingsTotalCents: 20_000,
        savingsGoals: [{ id: "g", allocatedCents: 18_000 }],
      }),
    );
    seed(`${userPath}/months/2026-10`, deficitMonth());
    seed(`${userPath}/months/2026-11`, month());

    const result = await confirmMonthClose("u", "2026-10", "covered_by_savings");

    expect(result.coveredBySavingsCents).toBe(2_000);
    expect(result.uncoveredDeficitCents).toBe(8_000);
    const profile = mocks.docs.get(userPath)!;
    expect(profile.savingsTotalCents).toBe(18_000);
    expect(profile.savingsTotalCents).toBeGreaterThanOrEqual(18_000);
    expect(monthDoc("2026-10").remainder).toMatchObject({
      deficitResolution: "covered_by_savings",
      coveredBySavingsCents: 2_000,
      uncoveredDeficitCents: 8_000,
    });
  });

  it("carried_forward traslada el déficit al mes nuevo sin tocar ahorro", async () => {
    vi.setSystemTime(new Date(2026, 10, 2, 10, 0));
    seed(
      userPath,
      user({
        lastClosedMonth: "2026-11",
        pendingCloseMonthId: "2026-10",
        savingsTotalCents: 20_000,
      }),
    );
    seed(`${userPath}/months/2026-10`, deficitMonth());
    seed(`${userPath}/months/2026-11`, month());

    const result = await confirmMonthClose("u", "2026-10", "carried_forward");

    expect(result.carriedDeficitCents).toBe(10_000);
    expect(monthDoc("2026-11").carriedDeficitCents).toBe(10_000);
    expect(mocks.docs.get(userPath)?.savingsTotalCents).toBe(20_000);
    expect(monthDoc("2026-10").remainder).toMatchObject({
      netDeficitCents: 10_000,
      deficitResolution: "carried_forward",
    });
  });

  it("none solo registra el déficit y no acredita ni descuenta ahorro", async () => {
    vi.setSystemTime(new Date(2026, 10, 2, 10, 0));
    seed(
      userPath,
      user({
        lastClosedMonth: "2026-11",
        pendingCloseMonthId: "2026-10",
        savingsTotalCents: 20_000,
      }),
    );
    seed(`${userPath}/months/2026-10`, deficitMonth());
    seed(`${userPath}/months/2026-11`, month());

    const result = await confirmMonthClose("u", "2026-10", "none");

    expect(result).toEqual({
      closedMonthId: "2026-10",
      coveredBySavingsCents: 0,
      uncoveredDeficitCents: 10_000,
      carriedDeficitCents: 0,
    });
    expect(monthDoc("2026-11").carriedDeficitCents).toBeUndefined();
    expect(mocks.docs.get(userPath)?.savingsTotalCents).toBe(20_000);
    expect(monthDoc("2026-10").remainder).toMatchObject({
      netDeficitCents: 10_000,
      deficitResolution: "none",
    });
  });

  it("día 4 sin decisión: cierra automáticamente con deficitResolution none y déficit visible", async () => {
    const now = new Date(2026, 10, 4, 10, 0);
    vi.setSystemTime(now);
    seed(
      userPath,
      user({
        lastClosedMonth: "2026-11",
        pendingCloseMonthId: "2026-10",
        savingsTotalCents: 20_000,
      }),
    );
    seed(`${userPath}/months/2026-10`, deficitMonth());
    seed(`${userPath}/months/2026-11`, month());

    const result = await checkAndCloseMonth("u", now);

    expect(result.closedMonthId).toBe("2026-10");
    expect(monthDoc("2026-10")).toMatchObject({
      closed: true,
      remainder: {
        netDeficitCents: 10_000,
        deficitResolution: "none",
      },
    });
    expect(mocks.docs.get(userPath)).toMatchObject({
      lastClosedMonth: "2026-11",
      pendingCloseMonthId: null,
      unseenClosedMonthId: "2026-10",
      savingsTotalCents: 20_000,
    });
  });

  it("cierre multi-mes incluye un pendiente vencido y conserva la gracia del mes inmediato anterior", async () => {
    const now = new Date(2026, 10, 2, 10, 0);
    vi.setSystemTime(now);
    seed(
      userPath,
      user({
        lastClosedMonth: "2026-09",
        pendingCloseMonthId: "2026-09",
      }),
    );
    seed(`${userPath}/months/2026-09`, month());

    await checkAndCloseMonth("u", now);

    expect(monthDoc("2026-09").closed).toBe(true);
    expect(monthDoc("2026-10").closed).toBe(false);
    expect(monthDoc("2026-11").closed).toBe(false);
    expect(mocks.docs.get(userPath)).toMatchObject({
      lastClosedMonth: "2026-11",
      pendingCloseMonthId: "2026-10",
      unseenClosedMonthId: "2026-09",
    });
  });

  it("recordClosedMonthAdjustment deja inmutable el mes cerrado y registra el ajuste en el actual", async () => {
    vi.setSystemTime(new Date(2026, 10, 15, 10, 0));
    seed(
      userPath,
      user({
        lastClosedMonth: "2026-11",
        savingsTotalCents: 5_000,
      }),
    );
    const closedSnapshot = deficitMonth({
      closed: true,
      remainder: { ocioToAhorroCents: 0, netDeficitCents: 10_000 },
    });
    seed(`${userPath}/months/2026-10`, closedSnapshot);
    seed(`${userPath}/months/2026-11`, month({
      capsCents: { necesidad: 100_000, ocio: 50_000 },
      spentCents: { necesidad: 8_000, ocio: 0 },
    }));

    await recordClosedMonthAdjustment("u", {
      referenceMonthId: "2026-10",
      category: "necesidad",
      deltaCents: -5_000,
      reason: "Corregir tope del mes anterior",
    });

    expect(monthDoc("2026-10")).toEqual(closedSnapshot);
    expect(monthDoc("2026-11").capsCents.necesidad).toBe(95_000);
    const movementPath = [...mocks.docs.keys()].find((path) =>
      path.startsWith(`${userPath}/months/2026-11/movements/`),
    )!;
    expect(mocks.docs.get(movementPath)).toMatchObject({
      kind: "closed_month_adjustment",
      referenceMonthId: "2026-10",
      category: "necesidad",
      deltaCents: -5_000,
      origin: "necesidad",
      destination: "necesidad",
      amountCents: 5_000,
      reason: "Corregir tope del mes anterior",
    });
  });

  it("exige confirmación explícita si el ajuste deja el tope bajo lo ya gastado", async () => {
    vi.setSystemTime(new Date(2026, 10, 15, 10, 0));
    seed(userPath, user({ lastClosedMonth: "2026-11" }));
    seed(`${userPath}/months/2026-10`, month({ closed: true }));
    seed(`${userPath}/months/2026-11`, month({
      capsCents: { necesidad: 10_000, ocio: 0 },
      spentCents: { necesidad: 8_000, ocio: 0 },
    }));

    await expect(
      recordClosedMonthAdjustment("u", {
        referenceMonthId: "2026-10",
        category: "necesidad",
        deltaCents: -3_000,
        reason: "Ajuste sin confirmar",
        currentMonthId: "2026-11",
      }),
    ).rejects.toThrow("Confirma explícitamente");

    await recordClosedMonthAdjustment("u", {
      referenceMonthId: "2026-10",
      category: "necesidad",
      deltaCents: -3_000,
      reason: "Ajuste confirmado",
      allowOverSpentCap: true,
      currentMonthId: "2026-11",
    });
    expect(monthDoc("2026-11").capsCents.necesidad).toBe(7_000);
  });

  it("meses legacy sin campos nuevos siguen funcionando", async () => {
    const now = new Date(2026, 10, 4, 10, 0);
    vi.setSystemTime(now);
    seed(userPath, {
      distribution: percentages,
      lastClosedMonth: "2026-10",
      savingsTotalCents: 0,
    });
    seed(`${userPath}/months/2026-10`, {
      totalIncomeCents: 0,
      distribution: percentages,
      capsCents: { necesidad: 10_000, ocio: 10_000 },
      spentCents: { necesidad: 4_000, ocio: 2_000 },
      ahorroContributedCents: 0,
      incomeCount: 0,
      closed: false,
      createdAt: "SEEDED",
    });

    const current = await ensureCurrentMonth("u", now);

    expect(current.closed).toBe(false);
    expect(monthDoc("2026-10").closed).toBe(true);
    expect(monthDoc("2026-10").remainder).toMatchObject({
      ocioToAhorroCents: 8_000,
      necesidadToNextMonthCents: 6_000,
      netDeficitCents: 0,
    });
  });
});
