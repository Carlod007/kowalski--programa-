import type { Timestamp } from "firebase/firestore";
import type { Category } from "./transaction";

export type MovementKind = "transfer" | "closed_month_adjustment";

/**
 * Registro inmutable de un traslado de excedente entre categorías (incluye
 * Ahorro) o un asiento de ajuste de mes cerrado. Se escribe atómicamente junto
 * con el ajuste real de capsCents / ahorroContributedCents / savingsTotalCents
 * - nunca se edita ni se borra. La trazabilidad empieza desde que existe este
 * tipo: los movimientos anteriores nunca quedaron registrados.
 */
export type Movement = {
  userId: string;
  monthId: string;
  origin: Category;
  destination: Category;
  amountCents: number;
  reason?: string;
  /**
   * Para asientos de ajuste de un mes ya cerrado (recordClosedMonthAdjustment):
   * se registra en el mes abierto actual referenciando el mes cerrado ajustado,
   * sin tocar el documento del mes cerrado.
   */
  kind?: MovementKind;
  referenceMonthId?: string;
  category?: Category;
  deltaCents?: number;
  transactionDate: string;
  serverDate: Timestamp | null;
};
