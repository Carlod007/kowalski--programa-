import type { Timestamp } from "firebase/firestore";
import type { Distribution } from "./transaction";

export type MonthRemainder = {
  ocioToAhorroCents: number;
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
  closed: boolean;
  remainder?: MonthRemainder;
  /**
   * Plata que entró y fue entera al ahorro, sin repartirse. Opcional: los
   * meses anteriores a esta función no lo tienen y valen 0.
   */
  directSavingsCents?: number;
  createdAt: Timestamp | null;
};
