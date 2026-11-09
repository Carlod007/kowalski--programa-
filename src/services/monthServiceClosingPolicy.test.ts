/* eslint-disable @typescript-eslint/no-explicit-any -- in-memory Firestore fixture */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

type DocData = Record<string, any>;

const mocks = vi.hoisted(() => ({
  docs: new Map<string, DocData>(),
  set: vi.fn(),
  update: vi.fn(),
}));

vi.mock("@/lib/firebase", () => ({ db: "db" }));
vi.mock("firebase/firestore", () => {
  function reference(...parts: (string | { path: string })[]) {
    const filtered = parts.filter((part) => part !== "db");
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
      if (
        rawValue &&
        typeof rawValue === "object" &&
        rawValue.__op === "increment"
      ) {
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
    runTransaction: async (_db: any, callback: (tx: any) => Promise<any>) => {
      const tx = {
        get: async (ref: { path: string }) => ({
          exists: () => mocks.docs.has(ref.path),
          data: () => mocks.docs.get(ref.path),
        }),
        set: (ref: { path: string }, data: DocData) => {
          mocks.set(ref.path, data);
          mocks.docs.set(ref.path, structuredClone(data));
        },
        update: (ref: { path: string }, patch: DocData) => {
          mocks.update(ref.path, patch);
          const current = mocks.docs.get(ref.path) ?? {};
          mocks.docs.set(ref.path, applyPatch(current, patch));
        },
      };
      return callback(tx);
    },
  };
});

import { checkAndCloseMonth, confirmMonthClose } from "./monthService";

describe("Cierre de mes con políticas de sobrante F6a", () => {
  beforeEach(() => {
    mocks.docs.clear();
    mocks.set.mockClear();
    mocks.update.mockClear();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("política: Necesidad se barre a Ahorro y Ocio pasa al mes nuevo (sweep_to_savings + rollover_all)", async () => {
    // 10 de octubre (fuera de gracia para 2026-09)
    const nowDate = new Date(2026, 9, 10, 12, 0, 0);

    mocks.docs.set("users/u1", {
      lastClosedMonth: "2026-09",
      distribution: { necesidad: 50, ocio: 30, ahorro: 20 },
      savingsTotalCents: 50_000,
      closingPolicy: {
        necesidadSurplus: "sweep_to_savings",
        ocioSurplus: "rollover_all",
      },
    });

    // Mes 2026-09:
    // Necesidad: cap 1000, gastado 600 -> sobrante 400
    // Ocio: cap 600, gastado 350 -> sobrante 250
    mocks.docs.set("users/u1/months/2026-09", {
      totalIncomeCents: 200_000,
      distribution: { necesidad: 50, ocio: 30, ahorro: 20 },
      capsCents: { necesidad: 100_000, ocio: 60_000 },
      spentCents: { necesidad: 60_000, ocio: 35_000 },
      borrowedCapsCents: { necesidad: 0, ocio: 0 },
      loanFundedSpentCents: { necesidad: 0, ocio: 0 },
      ahorroContributedCents: 40_000,
      incomeCount: 1,
      closed: false,
    });

    const res = await checkAndCloseMonth("u1", nowDate);
    expect(res).toEqual({ closedMonthId: "2026-09" });

    const m09 = mocks.docs.get("users/u1/months/2026-09")!;
    expect(m09.closed).toBe(true);
    // Necesidad se barrió a Ahorro (400), Ocio pasó al mes nuevo (250)
    expect(m09.remainder).toEqual({
      necesidadToNextMonthCents: 0,
      necesidadSweptToAhorroCents: 40_000,
      ocioToNextMonthCents: 25_000,
      ocioToAhorroCents: 0,
      netDeficitCents: 0,
      borrowedNecesidadCents: 0,
      borrowedOcioCents: 0,
      deficitResolution: "none",
      closedAt: "SERVER_TIMESTAMP",
    });

    // Perfil: Ahorro se incrementó en los 400 de Necesidad
    const userAfter = mocks.docs.get("users/u1")!;
    expect(userAfter.lastClosedMonth).toBe("2026-10");
    expect(userAfter.savingsTotalCents).toBe(90_000); // 50000 + 40000

    // Mes nuevo 2026-10: hereda 250 en Ocio
    const m10 = mocks.docs.get("users/u1/months/2026-10")!;
    expect(m10.capsCents.necesidad).toBe(0);
    expect(m10.capsCents.ocio).toBe(25_000);
    expect(m10.inheritedOcioCents).toBe(25_000);
  });

  it("confirmMonthClose con rollover_capped: pasa tope al mes nuevo y barre excedente a Ahorro", async () => {
    mocks.docs.set("users/u2", {
      lastClosedMonth: "2026-10",
      pendingCloseMonthId: "2026-09",
      distribution: { necesidad: 50, ocio: 30, ahorro: 20 },
      savingsTotalCents: 10_000,
      closingPolicy: {
        necesidadSurplus: "rollover_capped",
        necesidadRolloverCapCents: 15_000, // Tope S/ 150
        ocioSurplus: "sweep_to_savings",
      },
    });

    // Mes 2026-09:
    // Necesidad: cap 1000, gastado 600 -> sobrante 400 (40_000 centavos)
    // Con tope de 15_000: pasan 15_000 a 2026-10 y 25_000 se barren a Ahorro
    // Ocio: cap 600, gastado 400 -> sobrante 200 (20_000 centavos), se barre todo a Ahorro
    mocks.docs.set("users/u2/months/2026-09", {
      totalIncomeCents: 200_000,
      distribution: { necesidad: 50, ocio: 30, ahorro: 20 },
      capsCents: { necesidad: 100_000, ocio: 60_000 },
      spentCents: { necesidad: 60_000, ocio: 40_000 },
      borrowedCapsCents: { necesidad: 0, ocio: 0 },
      loanFundedSpentCents: { necesidad: 0, ocio: 0 },
      ahorroContributedCents: 40_000,
      incomeCount: 1,
      closed: false,
    });

    const res = await confirmMonthClose("u2", "2026-09", "none");
    expect(res.closedMonthId).toBe("2026-09");

    const m09 = mocks.docs.get("users/u2/months/2026-09")!;
    expect(m09.closed).toBe(true);
    expect(m09.remainder).toEqual({
      necesidadToNextMonthCents: 15_000,
      necesidadSweptToAhorroCents: 25_000,
      ocioToNextMonthCents: 0,
      ocioToAhorroCents: 20_000,
      netDeficitCents: 0,
      borrowedNecesidadCents: 0,
      borrowedOcioCents: 0,
      deficitResolution: "none",
      closedAt: "SERVER_TIMESTAMP",
    });

    // Ahorro total recibe 250 (Necesidad) + 200 (Ocio) = 450
    const userAfter = mocks.docs.get("users/u2")!;
    expect(userAfter.savingsTotalCents).toBe(55_000); // 10000 + 45000

    // Mes 2026-10 recibe los 15_000 de Necesidad
    const m10 = mocks.docs.get("users/u2/months/2026-10")!;
    expect(m10.capsCents.necesidad).toBe(15_000);
    expect(m10.inheritedNecesidadCents).toBe(15_000);
    expect(m10.capsCents.ocio).toBe(0);
  });

  it("mes con déficit neto: el neteo precede a cualquier política y no se barre dinero prestado", async () => {
    mocks.docs.set("users/u3", {
      lastClosedMonth: "2026-10",
      pendingCloseMonthId: "2026-09",
      distribution: { necesidad: 50, ocio: 30, ahorro: 20 },
      savingsTotalCents: 100_000,
      closingPolicy: {
        necesidadSurplus: "sweep_to_savings",
        ocioSurplus: "sweep_to_savings",
      },
    });

    // Mes 2026-09:
    // Necesidad gastó 1200 de 1000 (déficit 200)
    // Ocio gastó 100 de 600 (sobrante 500)
    // Prestado en Necesidad: 50 (no gastado)
    // Neteo: déficit 200 compensa con Ocio 500 -> Ocio neto = 300, Necesidad neta = 0.
    mocks.docs.set("users/u3/months/2026-09", {
      totalIncomeCents: 200_000,
      distribution: { necesidad: 50, ocio: 30, ahorro: 20 },
      capsCents: { necesidad: 100_000, ocio: 60_000 },
      spentCents: { necesidad: 120_000, ocio: 10_000 },
      borrowedCapsCents: { necesidad: 5_000, ocio: 0 },
      loanFundedSpentCents: { necesidad: 0, ocio: 0 },
      ahorroContributedCents: 40_000,
      incomeCount: 1,
      closed: false,
    });

    const res = await confirmMonthClose("u3", "2026-09", "none");
    expect(res.closedMonthId).toBe("2026-09");

    const m09 = mocks.docs.get("users/u3/months/2026-09")!;
    expect(m09.closed).toBe(true);
    // Necesidad tenía déficit, así que su sobrante propio es 0.
    // Ocio neto = 300 (30_000), se barre a Ahorro por política.
    // Dinero prestado (50) NO se barre a Ahorro, pasa al mes nuevo.
    expect(m09.remainder).toEqual({
      necesidadToNextMonthCents: 0,
      necesidadSweptToAhorroCents: 0,
      ocioToNextMonthCents: 0,
      ocioToAhorroCents: 25_000,
      netDeficitCents: 0,
      borrowedNecesidadCents: 5_000,
      borrowedOcioCents: 0,
      deficitResolution: "none",
      closedAt: "SERVER_TIMESTAMP",
    });

    const userAfter = mocks.docs.get("users/u3")!;
    expect(userAfter.savingsTotalCents).toBe(125_000); // 100000 + 25000

    const m10 = mocks.docs.get("users/u3/months/2026-10")!;
    // Solo el dinero prestado pasa a Necesidad
    expect(m10.capsCents.necesidad).toBe(5_000);
    expect(m10.borrowedCapsCents.necesidad).toBe(5_000);
    expect(m10.inheritedNecesidadCents).toBe(0);
  });
});
