import { describe, expect, it } from "vitest";
import { getMonthRemainders } from "./monthRemainders";

describe("cierre mensual con préstamos", () => {
  it("separa el excedente propio del dinero prestado", () => {
    const result = getMonthRemainders({
      capsCents: { necesidad: 100_000, ocio: 80_000 },
      spentCents: { necesidad: 60_000, ocio: 30_000 },
      borrowedCapsCents: { necesidad: 20_000, ocio: 40_000 },
      loanFundedSpentCents: { necesidad: 10_000, ocio: 15_000 },
    });

    expect(result).toEqual({
      owned: { necesidad: 30_000, ocio: 25_000 },
      borrowed: { necesidad: 10_000, ocio: 25_000 },
    });
  });

  it("mantiene el comportamiento anterior en meses sin campos de préstamo", () => {
    expect(
      getMonthRemainders({
        capsCents: { necesidad: 100_000, ocio: 80_000 },
        spentCents: { necesidad: 60_000, ocio: 30_000 },
      }),
    ).toEqual({
      owned: { necesidad: 40_000, ocio: 50_000 },
      borrowed: { necesidad: 0, ocio: 0 },
    });
  });

  it("mantiene separado el saldo prestado después de reasignarlo", () => {
    const result = getMonthRemainders({
      capsCents: { necesidad: 100_000, ocio: 50_000 },
      spentCents: { necesidad: 60_000, ocio: 0 },
      borrowedCapsCents: { necesidad: 60_000, ocio: 40_000 },
      loanFundedSpentCents: { necesidad: 60_000, ocio: 0 },
    });

    expect(result).toEqual({
      owned: { necesidad: 40_000, ocio: 10_000 },
      borrowed: { necesidad: 0, ocio: 40_000 },
    });
  });
});
