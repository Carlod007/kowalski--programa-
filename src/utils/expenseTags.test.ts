import { describe, expect, it } from "vitest";
import {
  getAvailableExpenseTags,
  hasExpenseTag,
  normalizeExpenseTags,
} from "./expenseTags";

describe("etiquetas de egresos", () => {
  it("limpia, deduplica y limita etiquetas", () => {
    expect(
      normalizeExpenseTags("#Trabajo, viaje, TRABAJO, salud, casa, café, extra"),
    ).toEqual(["Trabajo", "viaje", "salud", "casa", "café"]);
  });

  it("filtra sin distinguir mayúsculas", () => {
    expect(hasExpenseTag(["Trabajo", "Casa"], "trabajo")).toBe(true);
    expect(hasExpenseTag(["Trabajo"], "viaje")).toBe(false);
    expect(hasExpenseTag(undefined, null)).toBe(true);
  });

  it("reúne las etiquetas disponibles sin duplicarlas", () => {
    expect(
      getAvailableExpenseTags([
        { tags: ["Viaje", "Trabajo"] },
        { tags: ["trabajo", "Casa"] },
      ]),
    ).toEqual(["Casa", "Trabajo", "Viaje"]);
  });
});
