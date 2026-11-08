import type { Timestamp } from "firebase/firestore";
import type { Distribution } from "./transaction";

export type DeficitResolution =
  | "covered_by_savings"
  | "carried_forward"
  | "none";

export type MonthRemainder = {
  ocioToAhorroCents: number;
  necesidadToNextMonthCents?: number;
  netDeficitCents?: number;
  borrowedNecesidadCents?: number;
  borrowedOcioCents?: number;
  deficitResolution?: DeficitResolution;
  /** Parte del déficit cubierta con ahorro sin asignar en confirmMonthClose. */
  coveredBySavingsCents?: number;
  /** Parte del déficit que quedó pendiente cuando el ahorro sin asignar no alcanzó. */
  uncoveredDeficitCents?: number;
  closedAt?: Timestamp | null;
};

export type MonthCaps = {
  necesidad: number;
  ocio: number;
};

export type Month = {
  /**
   * Solo el ingreso que SÍ se repartió por porcentajes. Es la base sobre la
   * que se calculan los % de cada categoría, por eso los aportes directos a
   * Ahorro no entran acá: sumarlos bajaría el % de Necesidad y Ocio sin que
   * el usuario hubiera hecho nada mal.
   */
  totalIncomeCents: number;
  distribution: Distribution;
  capsCents: MonthCaps;
  spentCents: MonthCaps;
  ahorroContributedCents: number;
  incomeCount: number;
  /**
   * Cantidad de ingresos repartidos por porcentajes (excluye aportes directos
   * a Ahorro). Opcional en meses anteriores a F2b (fallback: totalIncomeCents > 0).
   */
  distributedIncomeCount?: number;
  closed: boolean;
  remainder?: MonthRemainder;
  /**
   * Excedente propio de Necesidad heredado del mes anterior al cerrarse.
   */
  inheritedNecesidadCents?: number;
  /**
   * Déficit neto arrastrado desde el mes anterior cuando el usuario eligió
   * "carried_forward". Reduce el disponible de Necesidad del mes nuevo sin
   * dejar capsCents negativo ni inventar un gasto en spentCents.
   */
  carriedDeficitCents?: number;
  /**
   * Plata que entró y fue entera al ahorro, sin repartirse. Opcional: los
   * meses anteriores a esta función no lo tienen y valen 0.
   */
  directSavingsCents?: number;
  /**
   * Parte de los topes que proviene de préstamos y gasto cubierto
   * explícitamente con esos fondos. Se guardan separados para que el cierre
   * nunca convierta dinero prestado en Ahorro.
   */
  borrowedCapsCents?: MonthCaps;
  loanFundedSpentCents?: MonthCaps;
  createdAt: Timestamp | null;
};
