import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { MemoryRouter } from "react-router-dom";
import { describe, expect, it, vi } from "vitest";
import type { User } from "@/types/user";

vi.mock("@/lib/firebase", () => ({
  db: {},
}));

import { GoalPurchaseStep } from "./RegisterExpense";

const mockUser = { uid: "test-user-123" } as unknown as import("firebase/auth").User;

const baseProfile: User = {
  name: "Test User",
  email: "test@example.com",
  sources: [],
  distribution: { necesidad: 50, ocio: 30, ahorro: 20 },
  subcategories: { necesidad: ["Comida"], ocio: ["Cine"] },
  paymentMethods: [],
  onboardingCompleted: true,
  lastClosedMonth: null,
  savingsTotalCents: 200000,
  savingsGoals: [
    {
      id: "goal-laptop",
      name: "Laptop",
      targetCents: 150000,
      allocatedCents: 150000,
      createdAt: null,
    },
  ],
};

describe("GoalPurchaseStep - método de pago no configurado", () => {
  it("muestra mensaje de advertencia con enlace a Ajustes y botón deshabilitado cuando no hay métodos de pago", () => {
    const html = renderToStaticMarkup(
      createElement(
        MemoryRouter,
        null,
        createElement(GoalPurchaseStep, {
          initialGoalId: "goal-laptop",
          onBack: () => {},
          user: mockUser,
          userProfile: { ...baseProfile, paymentMethods: [] },
        }),
      ),
    );

    expect(html).toContain("No tienes métodos de pago configurados");
    expect(html).toContain('href="/settings"');
    expect(html).toContain("Ajustes");
    expect(html).toContain("para poder registrar la compra");
    expect(html).toContain("disabled");
  });

  it("muestra las opciones de método de pago cuando el usuario sí tiene configurados", () => {
    const html = renderToStaticMarkup(
      createElement(
        MemoryRouter,
        null,
        createElement(GoalPurchaseStep, {
          initialGoalId: "goal-laptop",
          onBack: () => {},
          user: mockUser,
          userProfile: {
            ...baseProfile,
            paymentMethods: [
              { id: "pm-1", name: "Efectivo", type: "cash" },
              { id: "pm-2", name: "Tarjeta Débito", type: "digital" },
            ],
          },
        }),
      ),
    );

    expect(html).not.toContain("No tienes métodos de pago configurados");
    expect(html).toContain("Efectivo");
    expect(html).toContain("Tarjeta Débito");
  });
});
