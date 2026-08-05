import type { Timestamp } from "firebase/firestore";
import type { Category } from "./transaction";

/**
 * Registro inmutable de un traslado de excedente entre categorías (incluye
 * Ahorro). Se escribe atómicamente junto con el ajuste real de capsCents /
 * ahorroContributedCents / savingsTotalCents en moveSurplus — nunca se
 * edita ni se borra. La trazabilidad empieza desde que existe este tipo:
 * los movimientos anteriores nunca quedaron registrados.
 */
export type Movement = {
  userId: string;
  monthId: string;
  origin: Category;
  destination: Category;
  amountCents: number;
  reason?: string;
  transactionDate: string;
  serverDate: Timestamp | null;
};
