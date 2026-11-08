import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const hookHarness = vi.hoisted(() => ({
  stateValue: "" as string,
  cleanups: [] as (() => void)[],
  ensureCurrentMonthMock: vi.fn(() => Promise.resolve(null)),
}));

vi.mock("react", () => ({
  useState: (initial: string | (() => string)) => {
    const val = typeof initial === "function" ? initial() : initial;
    hookHarness.stateValue = val;
    const setter = (next: string) => {
      hookHarness.stateValue = next;
    };
    return [hookHarness.stateValue, setter];
  },
  useRef: <T>(initial: T) => ({ current: initial }),
  useEffect: (effect: () => void | (() => void)) => {
    const cleanup = effect();
    if (typeof cleanup === "function") {
      hookHarness.cleanups.push(cleanup);
    }
  },
}));

vi.mock("@/services/monthService", () => ({
  ensureCurrentMonth: hookHarness.ensureCurrentMonthMock,
}));

import { msUntilNextDay, useCurrentMonthId } from "./useCurrentMonthId";

describe("useCurrentMonthId", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    hookHarness.stateValue = "";
    hookHarness.cleanups = [];
    hookHarness.ensureCurrentMonthMock.mockClear();
  });

  afterEach(() => {
    for (const cleanup of hookHarness.cleanups) {
      cleanup();
    }
    vi.useRealTimers();
  });

  it("calcula el tiempo restante hasta el próximo cambio de día", () => {
    const now = new Date(2026, 8, 30, 23, 59, 0, 0); // 2026-09-30 23:59:00
    const ms = msUntilNextDay(now);
    // 60_000 ms + 50 ms de margen
    expect(ms).toBe(60_050);
  });

  it("actualiza el mes al cruzar medianoche del último día del mes y dispara ensureCurrentMonth", () => {
    // 30 de septiembre de 2026 a las 23:59:30
    vi.setSystemTime(new Date(2026, 8, 30, 23, 59, 30, 0));

    const onMonthChange = vi.fn();
    const initialMonthId = useCurrentMonthId({
      userId: "user-1",
      onMonthChange,
    });

    expect(initialMonthId).toBe("2026-09");
    expect(hookHarness.stateValue).toBe("2026-09");
    expect(hookHarness.ensureCurrentMonthMock).not.toHaveBeenCalled();

    // Avanzar 31 segundos (cruza medianoche hacia 2026-10-01 00:00:01)
    vi.advanceTimersByTime(31_000);

    expect(hookHarness.stateValue).toBe("2026-10");
    expect(hookHarness.ensureCurrentMonthMock).toHaveBeenCalledTimes(1);
    expect(hookHarness.ensureCurrentMonthMock).toHaveBeenCalledWith("user-1");
    expect(onMonthChange).toHaveBeenCalledWith("2026-10", "2026-09");
  });

  it("no dispara ensureCurrentMonth cuando cambia de día dentro del mismo mes", () => {
    // 14 de septiembre de 2026 a las 23:59:30
    vi.setSystemTime(new Date(2026, 8, 14, 23, 59, 30, 0));

    useCurrentMonthId("user-1");
    expect(hookHarness.stateValue).toBe("2026-09");

    // Avanzar al 15 de septiembre de 2026
    vi.advanceTimersByTime(31_000);

    expect(hookHarness.stateValue).toBe("2026-09");
    expect(hookHarness.ensureCurrentMonthMock).not.toHaveBeenCalled();
  });
});
