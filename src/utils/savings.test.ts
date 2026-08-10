import { describe, it, expect } from "vitest";
import {
  getAllocatedTotal,
  getAssignableCents,
  getGoalAllocated,
  getGoalKind,
  getGoalProgress,
  getPurchaseCount,
  getUnassignedCents,
  isOverAllocated,
  wasPurchased,
} from "./savings";
import type { SavingsGoal } from "../types/user";

function goal(overrides: Partial<SavingsGoal> = {}): SavingsGoal {
  return {
    id: "g1",
    name: "Meta",
    targetCents: 150000,
    createdAt: null,
    ...overrides,
  };
}

describe("compatibilidad con metas creadas antes de estos campos", () => {
  it("trata una meta sin tipo como de compra", () => {
    expect(getGoalKind(goal())).toBe("compra");
  });

  it("trata una meta sin asignado como cero", () => {
    expect(getGoalAllocated(goal())).toBe(0);
  });

  it("trata una meta sin contador de compras como nunca comprada", () => {
    expect(getPurchaseCount(goal())).toBe(0);
    expect(wasPurchased(goal())).toBe(false);
  });
});

describe("getUnassignedCents", () => {
  it("descuenta del ahorro total lo reservado en cada meta", () => {
    const goals = [
      goal({ id: "a", allocatedCents: 59000 }),
      goal({ id: "b", allocatedCents: 39000 }),
    ];
    expect(getUnassignedCents(209000, goals)).toBe(111000);
  });

  it("con el ahorro entero asignado no queda nada libre", () => {
    const goals = [goal({ id: "a", allocatedCents: 100000 })];
    expect(getUnassignedCents(100000, goals)).toBe(0);
  });

  it("devuelve negativo si el ahorro bajo despues de asignar", () => {
    // Pasa al corregir o borrar un ingreso ya registrado. No se disimula:
    // el negativo es la senal de que hay que liberar de alguna meta.
    const goals = [goal({ id: "a", allocatedCents: 150000 })];
    expect(getUnassignedCents(100000, goals)).toBe(-50000);
    expect(isOverAllocated(100000, goals)).toBe(true);
  });

  it("sin metas, todo el ahorro esta sin asignar", () => {
    expect(getUnassignedCents(209000, [])).toBe(209000);
  });
});

describe("getAssignableCents", () => {
  it("nunca ofrece un monto negativo para asignar", () => {
    // Si se ofreciera el negativo, la pantalla propondria mover dinero
    // inexistente y el servicio lo rechazaria despues.
    const goals = [goal({ id: "a", allocatedCents: 150000 })];
    expect(getAssignableCents(100000, goals)).toBe(0);
  });

  it("coincide con lo sin asignar cuando es positivo", () => {
    const goals = [goal({ id: "a", allocatedCents: 50000 })];
    expect(getAssignableCents(120000, goals)).toBe(70000);
  });
});

describe("getAllocatedTotal", () => {
  it("suma lo asignado incluyendo metas sin el campo", () => {
    const goals = [
      goal({ id: "a", allocatedCents: 30000 }),
      goal({ id: "b" }),
      goal({ id: "c", allocatedCents: 20000 }),
    ];
    expect(getAllocatedTotal(goals)).toBe(50000);
  });
});

describe("getGoalProgress en metas de compra", () => {
  it("solo permite comprar cuando la meta junto su objetivo", () => {
    const incompleta = getGoalProgress(
      goal({ kind: "compra", targetCents: 150000, allocatedCents: 39000 }),
    );
    expect(incompleta.isComplete).toBe(false);
    expect(incompleta.canPurchase).toBe(false);
    expect(incompleta.missingCents).toBe(111000);

    const completa = getGoalProgress(
      goal({ kind: "compra", targetCents: 150000, allocatedCents: 150000 }),
    );
    expect(completa.isComplete).toBe(true);
    expect(completa.canPurchase).toBe(true);
    expect(completa.missingCents).toBe(0);
  });

  it("una meta de compra nunca permite retiro parcial", () => {
    const progress = getGoalProgress(
      goal({ kind: "compra", allocatedCents: 150000 }),
    );
    expect(progress.canWithdraw).toBe(false);
  });

  it("no reporta faltante negativo si sobro asignado", () => {
    const progress = getGoalProgress(
      goal({ kind: "compra", targetCents: 100000, allocatedCents: 120000 }),
    );
    expect(progress.missingCents).toBe(0);
    expect(progress.barWidth).toBe(100);
  });
});

describe("getGoalProgress en fondos", () => {
  it("permite retirar aunque no haya llegado al objetivo", () => {
    // Es el punto del colchon de emergencia: no espera a estar completo.
    const progress = getGoalProgress(
      goal({ kind: "fondo", targetCents: 200000, allocatedCents: 59000 }),
    );
    expect(progress.isComplete).toBe(false);
    expect(progress.canWithdraw).toBe(true);
  });

  it("un fondo vacio no permite retirar", () => {
    const progress = getGoalProgress(
      goal({ kind: "fondo", targetCents: 200000, allocatedCents: 0 }),
    );
    expect(progress.canWithdraw).toBe(false);
  });

  it("un fondo nunca se compra, ni estando completo", () => {
    const progress = getGoalProgress(
      goal({ kind: "fondo", targetCents: 200000, allocatedCents: 200000 }),
    );
    expect(progress.isComplete).toBe(true);
    expect(progress.canPurchase).toBe(false);
  });
});

describe("barra de progreso", () => {
  it("no se pasa de 100 ni baja de 0", () => {
    expect(
      getGoalProgress(goal({ targetCents: 100000, allocatedCents: 250000 }))
        .barWidth,
    ).toBe(100);
    expect(
      getGoalProgress(goal({ targetCents: 100000, allocatedCents: 0 }))
        .barWidth,
    ).toBe(0);
  });

  it("no divide por cero si el objetivo es cero", () => {
    expect(
      getGoalProgress(goal({ targetCents: 0, allocatedCents: 5000 })).barWidth,
    ).toBe(0);
  });
});

describe("marca de meta ya adquirida", () => {
  it("figura como comprada mientras quede al menos una compra viva", () => {
    expect(wasPurchased(goal({ purchaseCount: 1 }))).toBe(true);
    expect(wasPurchased(goal({ purchaseCount: 2 }))).toBe(true);
  });

  it("deja de figurar al quedar sin compras", () => {
    // Ocurre al borrar la compra desde el historial.
    expect(wasPurchased(goal({ purchaseCount: 0 }))).toBe(false);
  });
});
