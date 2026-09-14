import { describe, expect, it } from "vitest";
import { resolveTheme } from "./theme";

describe("theme", () => {
  it("conserva las tres opciones disponibles", () => {
    expect(resolveTheme("light")).toBe("light");
    expect(resolveTheme("dark-neutral")).toBe("dark-neutral");
    expect(resolveTheme("dark-blue")).toBe("dark-blue");
  });

  it("migra el modo oscuro local creado durante el desarrollo", () => {
    expect(resolveTheme("dark")).toBe("dark-neutral");
  });

  it("usa claro cuando no existe una elección válida", () => {
    expect(resolveTheme(null)).toBe("light");
    expect(resolveTheme("sepia")).toBe("light");
  });
});
