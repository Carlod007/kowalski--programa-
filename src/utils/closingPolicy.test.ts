import { describe, expect, it } from "vitest";
import {
  applyClosingPolicy,
  DEFAULT_CLOSING_POLICY,
  DEFAULT_NECESIDAD_SURPLUS_POLICY,
  DEFAULT_OCIO_SURPLUS_POLICY,
  getClosingPolicy,
} from "./closingPolicy";

describe("getClosingPolicy", () => {
  it("devuelve los valores por defecto cuando no se pasa política o es nula", () => {
    expect(getClosingPolicy(undefined)).toEqual({
      necesidadSurplus: DEFAULT_NECESIDAD_SURPLUS_POLICY,
      necesidadRolloverCapCents: 0,
      ocioSurplus: DEFAULT_OCIO_SURPLUS_POLICY,
    });
    expect(getClosingPolicy(null)).toEqual({
      necesidadSurplus: "rollover_all",
      necesidadRolloverCapCents: 0,
      ocioSurplus: "sweep_to_savings",
    });
    expect(DEFAULT_CLOSING_POLICY).toEqual({
      necesidadSurplus: "rollover_all",
      ocioSurplus: "sweep_to_savings",
    });
  });

  it("reconoce las políticas válidas de Necesidad y Ocio", () => {
    expect(
      getClosingPolicy({
        necesidadSurplus: "sweep_to_savings",
        ocioSurplus: "rollover_all",
      }),
    ).toEqual({
      necesidadSurplus: "sweep_to_savings",
      necesidadRolloverCapCents: 0,
      ocioSurplus: "rollover_all",
    });

    expect(
      getClosingPolicy({
        necesidadSurplus: "rollover_capped",
        necesidadRolloverCapCents: 5000,
        ocioSurplus: "sweep_to_savings",
      }),
    ).toEqual({
      necesidadSurplus: "rollover_capped",
      necesidadRolloverCapCents: 5000,
      ocioSurplus: "sweep_to_savings",
    });
  });

  it("sanea topes inválidos, negativos o no enteros dejándolos en 0", () => {
    expect(
      getClosingPolicy({
        necesidadSurplus: "rollover_capped",
        necesidadRolloverCapCents: -500,
        ocioSurplus: "sweep_to_savings",
      }).necesidadRolloverCapCents,
    ).toBe(0);

    expect(
      getClosingPolicy({
        necesidadSurplus: "rollover_capped",
        necesidadRolloverCapCents: 12.34 as unknown as number,
        ocioSurplus: "sweep_to_savings",
      }).necesidadRolloverCapCents,
    ).toBe(0);

    expect(
      getClosingPolicy({
        necesidadSurplus: "rollover_capped",
        necesidadRolloverCapCents: undefined,
        ocioSurplus: "sweep_to_savings",
      }).necesidadRolloverCapCents,
    ).toBe(0);
  });
});

describe("applyClosingPolicy", () => {
  it("política por defecto: Necesidad pasa al mes nuevo, Ocio se barre a Ahorro", () => {
    const policy = getClosingPolicy();
    const destinations = applyClosingPolicy(
      { necesidadToNextMonthCents: 10_000, ocioToAhorroCents: 5_000 },
      policy,
    );

    expect(destinations).toEqual({
      necesidadToNextMonthCents: 10_000,
      necesidadSweptToAhorroCents: 0,
      ocioToNextMonthCents: 0,
      ocioToAhorroCents: 5_000,
    });
    // Conservación exacta
    expect(
      destinations.necesidadToNextMonthCents +
        destinations.necesidadSweptToAhorroCents,
    ).toBe(10_000);
    expect(
      destinations.ocioToNextMonthCents + destinations.ocioToAhorroCents,
    ).toBe(5_000);
  });

  it("política sweep_to_savings en Necesidad y rollover_all en Ocio", () => {
    const policy = getClosingPolicy({
      necesidadSurplus: "sweep_to_savings",
      ocioSurplus: "rollover_all",
    });
    const destinations = applyClosingPolicy(
      { necesidadToNextMonthCents: 10_000, ocioToAhorroCents: 5_000 },
      policy,
    );

    expect(destinations).toEqual({
      necesidadToNextMonthCents: 0,
      necesidadSweptToAhorroCents: 10_000,
      ocioToNextMonthCents: 5_000,
      ocioToAhorroCents: 0,
    });
    expect(
      destinations.necesidadToNextMonthCents +
        destinations.necesidadSweptToAhorroCents,
    ).toBe(10_000);
    expect(
      destinations.ocioToNextMonthCents + destinations.ocioToAhorroCents,
    ).toBe(5_000);
  });

  it("política rollover_capped en Necesidad: pasa hasta el tope y barre el resto", () => {
    const policy = getClosingPolicy({
      necesidadSurplus: "rollover_capped",
      necesidadRolloverCapCents: 4_000,
      ocioSurplus: "sweep_to_savings",
    });
    const destinations = applyClosingPolicy(
      { necesidadToNextMonthCents: 10_000, ocioToAhorroCents: 5_000 },
      policy,
    );

    expect(destinations).toEqual({
      necesidadToNextMonthCents: 4_000,
      necesidadSweptToAhorroCents: 6_000,
      ocioToNextMonthCents: 0,
      ocioToAhorroCents: 5_000,
    });
    expect(
      destinations.necesidadToNextMonthCents +
        destinations.necesidadSweptToAhorroCents,
    ).toBe(10_000);
  });

  it("política rollover_capped con tope mayor al sobrante: pasa todo y no barre nada", () => {
    const policy = getClosingPolicy({
      necesidadSurplus: "rollover_capped",
      necesidadRolloverCapCents: 15_000,
      ocioSurplus: "sweep_to_savings",
    });
    const destinations = applyClosingPolicy(
      { necesidadToNextMonthCents: 10_000, ocioToAhorroCents: 5_000 },
      policy,
    );

    expect(destinations).toEqual({
      necesidadToNextMonthCents: 10_000,
      necesidadSweptToAhorroCents: 0,
      ocioToNextMonthCents: 0,
      ocioToAhorroCents: 5_000,
    });
  });

  it("con sobrante 0 o negativo no genera dinero ficticio", () => {
    const policy = getClosingPolicy({
      necesidadSurplus: "rollover_capped",
      necesidadRolloverCapCents: 5_000,
      ocioSurplus: "rollover_all",
    });
    const destinations = applyClosingPolicy(
      { necesidadToNextMonthCents: 0, ocioToAhorroCents: 0 },
      policy,
    );

    expect(destinations).toEqual({
      necesidadToNextMonthCents: 0,
      necesidadSweptToAhorroCents: 0,
      ocioToNextMonthCents: 0,
      ocioToAhorroCents: 0,
    });
  });
});
