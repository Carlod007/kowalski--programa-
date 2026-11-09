import type {
  ClosingPolicy,
  NecesidadSurplusPolicy,
  OcioSurplusPolicy,
} from "@/types/user";
import type { MonthRemainders } from "@/utils/monthRemainders";

export const DEFAULT_NECESIDAD_SURPLUS_POLICY: NecesidadSurplusPolicy =
  "rollover_all";
export const DEFAULT_OCIO_SURPLUS_POLICY: OcioSurplusPolicy =
  "sweep_to_savings";

export const DEFAULT_CLOSING_POLICY: ClosingPolicy = {
  necesidadSurplus: DEFAULT_NECESIDAD_SURPLUS_POLICY,
  ocioSurplus: DEFAULT_OCIO_SURPLUS_POLICY,
};

export type ResolvedClosingPolicy = {
  necesidadSurplus: NecesidadSurplusPolicy;
  necesidadRolloverCapCents: number;
  ocioSurplus: OcioSurplusPolicy;
};

/**
 * Completa una política ausente con el comportamiento histórico: Necesidad
 * pasa al mes nuevo y Ocio va a Ahorro. Los usuarios legacy no cambian.
 */
export function getClosingPolicy(
  policy?: Partial<ClosingPolicy> | null,
): ResolvedClosingPolicy {
  const necesidadSurplus =
    policy?.necesidadSurplus === "sweep_to_savings" ||
    policy?.necesidadSurplus === "rollover_capped"
      ? policy.necesidadSurplus
      : DEFAULT_NECESIDAD_SURPLUS_POLICY;
  const rawCap = policy?.necesidadRolloverCapCents;
  const necesidadRolloverCapCents =
    typeof rawCap === "number" && Number.isInteger(rawCap) && rawCap >= 0
      ? rawCap
      : 0;
  const ocioSurplus =
    policy?.ocioSurplus === "rollover_all"
      ? policy.ocioSurplus
      : DEFAULT_OCIO_SURPLUS_POLICY;
  return {
    necesidadSurplus,
    necesidadRolloverCapCents,
    ocioSurplus,
  };
}

export type ClosingDestinations = {
  necesidadToNextMonthCents: number;
  necesidadSweptToAhorroCents: number;
  ocioToNextMonthCents: number;
  ocioToAhorroCents: number;
};

/**
 * Aplica la política SOLO al sobrante propio ya neteado por
 * `getMonthRemainders`. El dinero prestado nunca entra aquí y nunca se barre a
 * Ahorro. Conservación exacta: sobrante = pasa + se barre, por categoría.
 */
export function applyClosingPolicy(
  remainders: Pick<
    MonthRemainders,
    "necesidadToNextMonthCents" | "ocioToAhorroCents"
  >,
  policy: ResolvedClosingPolicy,
): ClosingDestinations {
  const necesidadSurplus = Math.max(
    0,
    remainders.necesidadToNextMonthCents,
  );
  const ocioSurplus = Math.max(0, remainders.ocioToAhorroCents);

  let necesidadToNextMonthCents = necesidadSurplus;
  if (policy.necesidadSurplus === "sweep_to_savings") {
    necesidadToNextMonthCents = 0;
  } else if (policy.necesidadSurplus === "rollover_capped") {
    necesidadToNextMonthCents = Math.min(
      necesidadSurplus,
      policy.necesidadRolloverCapCents,
    );
  }

  return {
    necesidadToNextMonthCents,
    necesidadSweptToAhorroCents:
      necesidadSurplus - necesidadToNextMonthCents,
    ocioToNextMonthCents:
      policy.ocioSurplus === "rollover_all" ? ocioSurplus : 0,
    ocioToAhorroCents:
      policy.ocioSurplus === "rollover_all" ? 0 : ocioSurplus,
  };
}
