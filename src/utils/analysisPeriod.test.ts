import { describe, expect, it } from "vitest";
import {
  getAnalysisDateRange,
  getMonthIdsInRange,
  isDateInAnalysisRange,
  validateAnalysisDateRange,
} from "./analysisPeriod";

describe("analysisPeriod", () => {
  it("construye el mes y ambas quincenas sin cambiar el mes contable", () => {
    expect(getAnalysisDateRange("2026-02", "month")).toEqual({
      fromDate: "2026-02-01",
      toDate: "2026-02-28",
    });
    expect(getAnalysisDateRange("2026-09", "first-half")).toEqual({
      fromDate: "2026-09-01",
      toDate: "2026-09-15",
    });
    expect(getAnalysisDateRange("2026-09", "second-half")).toEqual({
      fromDate: "2026-09-16",
      toDate: "2026-09-30",
    });
  });

  it("incluye todos los meses atravesados por un ciclo de pago", () => {
    expect(
      getMonthIdsInRange({
        fromDate: "2026-08-25",
        toDate: "2026-09-24",
      }),
    ).toEqual(["2026-08", "2026-09"]);
  });

  it("filtra por los extremos inclusivos", () => {
    const range = { fromDate: "2026-09-01", toDate: "2026-09-15" };
    expect(isDateInAnalysisRange("2026-09-01", range)).toBe(true);
    expect(isDateInAnalysisRange("2026-09-15", range)).toBe(true);
    expect(isDateInAnalysisRange("2026-09-16", range)).toBe(false);
  });

  it("rechaza rangos invertidos o mayores a un año", () => {
    expect(
      validateAnalysisDateRange({
        fromDate: "2026-09-15",
        toDate: "2026-09-01",
      }),
    ).toContain("inicial");
    expect(
      validateAnalysisDateRange({
        fromDate: "2025-01-01",
        toDate: "2026-01-02",
      }),
    ).toContain("máximo");
  });
});
