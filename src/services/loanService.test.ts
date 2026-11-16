import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  docs: new Map<string, Record<string, unknown>>(),
  subcollections: new Map<string, { id: string; path: string }[]>(),
  set: vi.fn(),
  update: vi.fn(),
  delete: vi.fn(),
  autoId: 0,
}));

function applyUpdate(
  current: Record<string, unknown>,
  patch: Record<string, unknown>,
): Record<string, unknown> {
  const next = structuredClone(current);
  for (const [key, rawValue] of Object.entries(patch)) {
    const parts = key.split(".");
    let cursor: Record<string, unknown> = next;
    for (let i = 0; i < parts.length - 1; i += 1) {
      const segment = parts[i];
      const existing = cursor[segment];
      cursor[segment] =
        existing && typeof existing === "object"
          ? { ...(existing as Record<string, unknown>) }
          : {};
      cursor = cursor[segment] as Record<string, unknown>;
    }
    const leaf = parts[parts.length - 1];
    if (
      rawValue &&
      typeof rawValue === "object" &&
      "__op" in rawValue &&
      (rawValue as { __op: string }).__op === "increment"
    ) {
      const delta = (rawValue as unknown as { value: number }).value;
      const prev = typeof cursor[leaf] === "number" ? (cursor[leaf] as number) : 0;
      cursor[leaf] = prev + delta;
    } else {
      cursor[leaf] = rawValue;
    }
  }
  return next;
}

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
      return {
        id: `generated-${mocks.autoId}`,
        path: `${filtered[0].path}/generated-${mocks.autoId}`,
      };
    }
    const fullPath = filtered
      .map((p) => (typeof p === "string" ? p : p.path))
      .join("/");
    const segments = fullPath.split("/");
    return {
      id: segments[segments.length - 1],
      path: fullPath,
    };
  },
  collection: (...parts: (string | { path: string })[]) => ({
    path: parts
      .filter((p) => p !== "db")
      .map((p) => (typeof p === "string" ? p : p.path))
      .join("/"),
  }),
  getDocs: async (colRef: { path: string }) => {
    const items = mocks.subcollections.get(colRef.path) ?? [];
    return {
      size: items.length,
      docs: items.map((item) => ({
        id: item.id,
        ref: { path: item.path },
      })),
    };
  },
  increment: (n: number) => ({ __op: "increment", value: n }),
  serverTimestamp: () => "SERVER_TIMESTAMP",
  runTransaction: async (_db: unknown, callback: (t: unknown) => unknown) =>
    callback({
      get: async (ref: { path: string }) => ({
        exists: () => mocks.docs.has(ref.path),
        data: () => mocks.docs.get(ref.path),
      }),
      set: (ref: { path: string }, data: Record<string, unknown>) => {
        mocks.set(ref.path, data);
        mocks.docs.set(ref.path, structuredClone(data));
      },
      update: (ref: { path: string }, data: Record<string, unknown>) => {
        mocks.update(ref.path, data);
        const current = mocks.docs.get(ref.path) ?? {};
        mocks.docs.set(ref.path, applyUpdate(current, data));
      },
      delete: (ref: { path: string }) => {
        mocks.delete(ref.path);
        mocks.docs.delete(ref.path);
      },
    }),
}));

import { cancelUnusedLoan, createLoan, recordLoanPayment } from "./loanService";

const userId = "u1";
const monthId = "2026-09";
const monthPath = `users/${userId}/months/${monthId}`;
const loanId = "loan-500";
const loanPath = `users/${userId}/loans/${loanId}`;
const receiptPath = `${monthPath}/transactions/receipt-500`;

function seedOpenMonthWithLoan500(overrides?: {
  month?: Record<string, unknown>;
  loan?: Record<string, unknown>;
}) {
  mocks.docs.set(monthPath, {
    closed: false,
    capsCents: { necesidad: 150_000, ocio: 60_000 },
    borrowedCapsCents: { necesidad: 50_000, ocio: 0 },
    spentCents: { necesidad: 20_000, ocio: 10_000 },
    loanFundedSpentCents: { necesidad: 0, ocio: 0 },
    ...overrides?.month,
  });
  mocks.docs.set(loanPath, {
    userId,
    lender: "Banco",
    amountReceivedCents: 50_000,
    totalToRepayCents: 55_000,
    scheduleType: "total-known",
    receivedDate: "2026-09-10",
    receivedMonthId: monthId,
    destinationCategory: "necesidad",
    borrowedAvailableCents: 50_000,
    borrowedAvailableByCategory: { necesidad: 50_000, ocio: 0 },
    paidCents: 0,
    fundMovementCount: 0,
    installments: [
      {
        id: "installment-1",
        number: 1,
        dueDate: "2026-10-10",
        amountCents: 55_000,
        paidCents: 0,
      },
    ],
    receiptTransactionId: "receipt-500",
    createdAt: "SERVER_TIMESTAMP",
    updatedAt: "SERVER_TIMESTAMP",
    ...overrides?.loan,
  });
  mocks.docs.set(receiptPath, {
    type: "loan",
    loanId,
    destinationCategory: "necesidad",
    amountCents: 50_000,
    transactionDate: "2026-09-10",
  });
}

describe("cancelUnusedLoan en loanService", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date(2026, 8, 15, 12, 0));
    mocks.docs.clear();
    mocks.subcollections.clear();
    mocks.set.mockClear();
    mocks.update.mockClear();
    mocks.delete.mockClear();
    mocks.autoId = 0;
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("préstamo de S/ 500 (50_000 centavos) sin usar: borrar devuelve capsCents y borrowedCapsCents a su valor anterior", async () => {
    mocks.docs.set(monthPath, {
      closed: false,
      capsCents: { necesidad: 100_000, ocio: 60_000 },
      borrowedCapsCents: { necesidad: 0, ocio: 0 },
      spentCents: { necesidad: 20_000, ocio: 10_000 },
      loanFundedSpentCents: { necesidad: 0, ocio: 0 },
    });

    const createdLoanId = await createLoan(userId, {
      lender: "Banco",
      amountReceivedCents: 50_000,
      receivedDate: "2026-09-10",
      scheduleType: "total-known",
      totalToRepayCents: 55_000,
      installmentCount: 1,
      firstDueDate: "2026-10-10",
    });

    expect(mocks.docs.get(monthPath)?.capsCents).toEqual({
      necesidad: 150_000,
      ocio: 60_000,
    });
    expect(mocks.docs.get(monthPath)?.borrowedCapsCents).toEqual({
      necesidad: 50_000,
      ocio: 0,
    });

    await cancelUnusedLoan(userId, createdLoanId);

    expect(mocks.docs.get(monthPath)?.capsCents).toEqual({
      necesidad: 100_000,
      ocio: 60_000,
    });
    expect(mocks.docs.get(monthPath)?.borrowedCapsCents).toEqual({
      necesidad: 0,
      ocio: 0,
    });
    expect(mocks.docs.has(`users/${userId}/loans/${createdLoanId}`)).toBe(
      false,
    );
  });

  it("bloquea borrar un préstamo con pago registrado con el mensaje exacto", async () => {
    seedOpenMonthWithLoan500({
      loan: {
        paidCents: 10_000,
        installments: [
          {
            id: "installment-1",
            number: 1,
            dueDate: "2026-10-10",
            amountCents: 55_000,
            paidCents: 10_000,
          },
        ],
      },
    });

    await expect(cancelUnusedLoan(userId, loanId)).rejects.toThrow(
      "Este préstamo tiene pagos registrados.",
    );
    expect(mocks.update).not.toHaveBeenCalled();
    expect(mocks.delete).not.toHaveBeenCalled();
  });

  it("bloquea borrar un préstamo con dinero prestado gastado con el mensaje exacto", async () => {
    seedOpenMonthWithLoan500({
      loan: {
        borrowedAvailableCents: 30_000,
        borrowedAvailableByCategory: { necesidad: 30_000, ocio: 0 },
      },
    });

    await expect(cancelUnusedLoan(userId, loanId)).rejects.toThrow(
      "Este préstamo ya financió gastos.",
    );
    expect(mocks.update).not.toHaveBeenCalled();
    expect(mocks.delete).not.toHaveBeenCalled();
  });

  it("bloquea borrar un préstamo cuyo mes de recepción está cerrado con el mensaje exacto", async () => {
    seedOpenMonthWithLoan500({
      month: { closed: true },
    });

    await expect(cancelUnusedLoan(userId, loanId)).rejects.toThrow(
      "No se puede borrar un préstamo registrado en un mes que ya está cerrado.",
    );
    expect(mocks.update).not.toHaveBeenCalled();
    expect(mocks.delete).not.toHaveBeenCalled();
  });

  it("bloquea borrar un préstamo si dejaría el tope del mes por debajo de lo ya gastado", async () => {
    seedOpenMonthWithLoan500({
      month: {
        capsCents: { necesidad: 100_000, ocio: 60_000 },
        borrowedCapsCents: { necesidad: 50_000, ocio: 0 },
        spentCents: { necesidad: 70_000, ocio: 10_000 },
        loanFundedSpentCents: { necesidad: 0, ocio: 0 },
      },
    });

    await expect(cancelUnusedLoan(userId, loanId)).rejects.toThrow(
      "La operación dejaría el tope del mes por debajo de lo ya gastado.",
    );
    expect(mocks.update).not.toHaveBeenCalled();
    expect(mocks.delete).not.toHaveBeenCalled();
  });

  it("préstamo importado con saldo pendiente de 300 en 3 cuotas: no altera capsCents ni borrowedCapsCents, permite pagar 100 del sobre origen y borrar sin pagos sin tocar topes", async () => {
    mocks.docs.set(`users/${userId}`, {
      savingsTotalCents: 10_000,
      savingsGoals: [],
    });
    mocks.docs.set(monthPath, {
      closed: false,
      capsCents: { necesidad: 100_000, ocio: 60_000 },
      borrowedCapsCents: { necesidad: 0, ocio: 0 },
      spentCents: { necesidad: 20_000, ocio: 10_000 },
      loanFundedSpentCents: { necesidad: 0, ocio: 0 },
    });

    const importedId = await createLoan(userId, {
      lender: "BCP",
      importedExisting: true,
      receivedDate: "2026-06-10",
      scheduleType: "total-known",
      totalToRepayCents: 30_000,
      installmentCount: 3,
      firstDueDate: "2026-09-20",
    });

    const importedLoanPath = `users/${userId}/loans/${importedId}`;
    const importedLoan = mocks.docs.get(importedLoanPath);
    expect(importedLoan?.borrowedAvailableCents).toBe(0);
    expect(importedLoan?.borrowedAvailableByCategory).toEqual({
      necesidad: 0,
      ocio: 0,
    });
    expect(mocks.docs.get(monthPath)?.capsCents).toEqual({
      necesidad: 100_000,
      ocio: 60_000,
    });
    expect(mocks.docs.get(monthPath)?.borrowedCapsCents).toEqual({
      necesidad: 0,
      ocio: 0,
    });

    // Borrar un préstamo importado sin pagos no cambia los topes
    await cancelUnusedLoan(userId, importedId);
    expect(mocks.docs.has(importedLoanPath)).toBe(false);
    expect(mocks.docs.get(monthPath)?.capsCents).toEqual({
      necesidad: 100_000,
      ocio: 60_000,
    });
    expect(mocks.docs.get(monthPath)?.borrowedCapsCents).toEqual({
      necesidad: 0,
      ocio: 0,
    });

    // Volver a importar el préstamo de 300 en 3 cuotas y pagar una cuota de 100
    const paidImportedId = await createLoan(userId, {
      lender: "BCP",
      importedExisting: true,
      receivedDate: "2026-06-10",
      scheduleType: "total-known",
      totalToRepayCents: 30_000,
      installmentCount: 3,
      firstDueDate: "2026-09-20",
    });

    await recordLoanPayment(userId, monthId, paidImportedId, {
      amountCents: 10_000,
      paymentDate: "2026-09-15",
      sourceCategory: "necesidad",
      paymentMethod: "Efectivo",
    });

    const monthAfterPayment = mocks.docs.get(monthPath) as {
      capsCents: { necesidad: number; ocio: number };
      spentCents: { necesidad: number; ocio: number };
    };
    // El disponible del sobre origen (capsCents.necesidad - spentCents.necesidad) baja en 10_000 (S/ 100): de 80_000 a 70_000
    expect(
      monthAfterPayment.capsCents.necesidad -
        monthAfterPayment.spentCents.necesidad,
    ).toBe(70_000);
    expect(
      mocks.docs.get(`users/${userId}/loans/${paidImportedId}`)?.paidCents,
    ).toBe(10_000);
  });
});
